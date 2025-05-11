import React, { useState, useRef, useEffect } from "react";
import FileList from "./components/FileList";
import DropzoneArea from "./components/DropzoneArea";
import QRCodeBlock from "./components/QRCodeBlock";
import Modal from "./components/Modal"; // Import Modal component
import { useSocket } from "./hooks/useSocket";
import { useServiceWorker } from "./hooks/useServiceWorker";
import { startWebRTC } from "./hooks/useWebRTC";
import { makeFileId } from "./utils/fileHelpers";
import { useZipDownload } from "./hooks/useZipDownload";
import { getIceServers } from "./utils/signaling";
import NoSleep from "nosleep.js";

function App() {
  function getInitialStepAndDriveCode() {
    const pathDriveCode = window.location.pathname.slice(1).toUpperCase();
    const asReceiver =
      new URLSearchParams(window.location.search).get("as") === "receiver";
    if (
      pathDriveCode.length === 4 &&
      /^[A-Z]+$/.test(pathDriveCode) &&
      asReceiver
    ) {
      return { step: "receiver", driveCode: pathDriveCode };
    }
    return { step: "init", driveCode: "" };
  }

  const initial = getInitialStepAndDriveCode();
  const [step, setStep] = useState(initial.step);
  const [files, setFiles] = useState([]);
  const [driveCode, setDriveCode] = useState(initial.driveCode);
  const [joinDriveCodeInput, setJoinDriveCodeInput] = useState("");
  const [isJoiningDrive, setIsJoiningDrive] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const [receiverFilesMeta, setReceiverFilesMeta] = useState([]);
  const [error, setError] = useState("");
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());
  const [showToast, setShowToast] = useState(false);
  const toastTimeoutRef = useRef(null);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [showWhyModal, setShowWhyModal] = useState(false);

  const fileBlobs = useRef({});
  const peerConns = useRef({});
  const dataChannels = useRef({});
  const filesRef = useRef(files);
  const socket = useSocket();
  const { postMessage } = useServiceWorker();
  const pendingSignals = useRef({});
  window.pendingSignals = pendingSignals.current;

  useEffect(() => {
    const handleConnect = () =>
      console.log("[Socket] Connected to signaling server. ID:", socket.id);
    const handleDisconnect = (reason) =>
      console.warn(
        "[Socket] Disconnected from signaling server. Reason:",
        reason
      );
    const handleConnectError = (error) =>
      console.error("[Socket] Connection error with signaling server:", error);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);

    if (socket.connected) {
      handleConnect();
    } else {
      console.log("[Socket] Initially not connected. Attempting to connect...");
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
    };
  }, [socket]);
  const activeZipPcHeartbeats = useRef({});
  const prevDriveCodeRef = useRef(null);
  const prevStepRef = useRef();
  const noSleepRef = useRef(null);

  useEffect(() => {
    if (!noSleepRef.current) {
      noSleepRef.current = new NoSleep();
    }

    const enableWakeLockOnClick = () => {
      if (noSleepRef.current && !noSleepRef.current.isEnabled) {
        noSleepRef.current
          .enable()
          .then(() => {
            console.log(
              "NoSleep.js enabled successfully after user interaction."
            );
          })
          .catch((err) => {
            console.error("Failed to enable NoSleep.js:", err);
          });
      }
    };

    document.body.addEventListener("click", enableWakeLockOnClick, {
      once: true,
    });
    document.body.addEventListener("touchstart", enableWakeLockOnClick, {
      once: true,
    });

    return () => {
      document.body.removeEventListener("click", enableWakeLockOnClick);
      document.body.removeEventListener("touchstart", enableWakeLockOnClick);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    prevStepRef.current = step;
  }, [step]);

  const handleSignal = React.useCallback(
    ({ fileId, data, room }) => {
      const pc = peerConns.current[fileId];
      if (!pc) {
        if (!pendingSignals.current[fileId]) {
          pendingSignals.current[fileId] = [];
        }
        pendingSignals.current[fileId].push({ data, room });
        return;
      }
      if (data && data.sdp) {
        const sdp = new RTCSessionDescription(data.sdp);
        if (sdp.type === "offer") {
          pc.setRemoteDescription(sdp)
            .then(() => pc.createAnswer())
            .then((answer) => pc.setLocalDescription(answer))
            .then(() => {
              if (pc.localDescription) {
                socket.emit("signal", {
                  room: driveCode,
                  fileId,
                  data: { sdp: pc.localDescription },
                });
              }
            })
            .catch((e) =>
              console.error(`[App] Error handling offer for ${fileId}:`, e)
            );
        } else if (sdp.type === "answer") {
          pc.setRemoteDescription(sdp).catch((e) =>
            console.error(
              `[App] Error setting remote description (answer) for ${fileId}:`,
              e
            )
          );
        }
      } else if (data && data.candidate) {
        const candidate = new RTCIceCandidate(data.candidate);
        pc.addIceCandidate(candidate).catch((e) => {
          if (
            !e.message.includes("OperationError") &&
            !e.message.includes("InvalidStateError")
          ) {
            console.error(`[App] Error adding ICE candidate for ${fileId}:`, e);
          }
        });
      }
    },
    [socket, peerConns, dataChannels, driveCode]
  );

  const cleanupWebRTCInstance = React.useCallback(
    (id) => {
      console.log(`[App Cleanup] Attempting to clean up for PC ID: ${id}`);
      const pc = peerConns.current[id];

      if (pc) {
        if (pc._iceTimeoutId) {
          clearTimeout(pc._iceTimeoutId);
          delete pc._iceTimeoutId;
          console.log(`[App Cleanup] Cleared ICE timeout for PC ID: ${id}`);
        }

        if (pc._associatedTransferIds) {
          console.log(
            `[App Cleanup] PC ID: ${id} is a zip PC. Cleaning associated DCs:`,
            Array.from(pc._associatedTransferIds)
          );
          pc._associatedTransferIds.forEach((transferId) => {
            const associatedDc = dataChannels.current[transferId];
            if (associatedDc) {
              try {
                if (associatedDc.readyState !== "closed") associatedDc.close();
                console.log(
                  `[App Cleanup] Closed associated DC: ${transferId} for PC ID: ${id}`
                );
              } catch (e) {
                console.warn(
                  `[App Cleanup] Error closing associated DC ${transferId}:`,
                  e
                );
              }
              delete dataChannels.current[transferId];
            }
          });
          delete pc._associatedTransferIds;
        } else {
          const singleDc = dataChannels.current[id];
          if (singleDc) {
            console.log(
              `[App Cleanup] PC ID: ${id} might be for a single DC. Cleaning DC: ${id}`
            );
            try {
              if (singleDc.readyState !== "closed") singleDc.close();
              console.log(`[App Cleanup] Closed single DC: ${id}`);
            } catch (e) {
              console.warn(`[App Cleanup] Error closing single DC ${id}:`, e);
            }
            delete dataChannels.current[id];
          }
        }

        try {
          if (pc.signalingState !== "closed") {
            pc.close();
            console.log(`[App Cleanup] Closed PC ID: ${id}`);
          }
        } catch (e) {
          console.warn(`[App Cleanup] Error closing PC ID ${id}:`, e);
        }
        delete peerConns.current[id];
      } else {
        console.warn(
          `[App Cleanup] No PeerConnection found for ID: ${id} during cleanup attempt.`
        );
        if (dataChannels.current[id]) {
          console.log(
            `[App Cleanup] Found orphaned DC with ID: ${id}. Cleaning it.`
          );
          try {
            if (dataChannels.current[id].readyState !== "closed")
              dataChannels.current[id].close();
          } catch (e) {
            /*ignore*/
          }
          delete dataChannels.current[id];
        }
      }

      if (activeZipPcHeartbeats.current.hasOwnProperty(id)) {
        delete activeZipPcHeartbeats.current[id];
        console.log(
          `[App Cleanup] Removed PC ID: ${id} from heartbeat tracking.`
        );
      }

      if (pendingSignals.current && pendingSignals.current[id]) {
        delete pendingSignals.current[id];
        console.log(`[App Cleanup] Cleared pending signals for PC ID: ${id}`);
      }
      console.log(`[App Cleanup] Finished cleanup for ID: ${id}`);
    },
    [peerConns, dataChannels, pendingSignals, activeZipPcHeartbeats]
  );

  function sendSWMetaAndChunk(fileId, chunk, filename, mimeType, fileSize) {
    if (!navigator.serviceWorker.controller) {
      console.error("[App] SW Ctrl not available for sendSWMetaAndChunk");
      return;
    }
    if (filename && (!chunk || chunk === null)) {
      const sizeToSend =
        typeof fileSize === "number" && fileSize > 0 ? fileSize : undefined;
      navigator.serviceWorker.controller.postMessage({
        type: "meta",
        fileId,
        filename: filename,
        mimetype: mimeType || "application/octet-stream",
        fileSize: sizeToSend,
      });
      return;
    }
    if (chunk) {
      navigator.serviceWorker.controller.postMessage(
        { type: "chunk", fileId, chunk, done: false },
        [chunk instanceof ArrayBuffer ? chunk : undefined]
      );
    }
  }

  const handleDownloadRequest = (fileId) => {
    setError("");
    if (downloadingFiles.has(fileId)) return;
    setDownloadingFiles((prev) => new Set(prev).add(fileId));
    const fileMeta = receiverFilesMeta.find((f) => f.fileId === fileId);
    if (!fileMeta) return;
    const transferFileId = makeFileId();
    const downloadUrl = `/sw-download/${transferFileId}`;
    const newTab = window.open(downloadUrl, "_blank");
    if (!newTab) {
      setError("Popup blocked! Please allow popups for this site.");
      setDownloadingFiles((prev) => {
        const s = new Set(prev);
        s.delete(fileId);
        return s;
      });
      return;
    }
    window.__downloadDebug = window.__downloadDebug || {};
    window.__downloadDebug[fileId] = {
      started: Date.now(),
      fileName: fileMeta.name,
      transferFileId,
    };
    setTimeout(() => {
      if (downloadingFiles.has(fileId))
        console.warn(`[App Receiver] Single download stuck for ${fileId}`);
    }, 10000);

    const swHandler = async (event) => {
      if (
        event.data.type === "sw-ready" &&
        event.data.fileId === transferFileId
      ) {
        postMessage({
          fileId: transferFileId,
          filename: fileMeta.name,
          mimetype: fileMeta.type,
          fileSize: fileMeta.size,
        });
        socket.emit("download-file", {
          room: driveCode,
          fileId: fileMeta.fileId,
          transferFileId,
          name: fileMeta.name,
          size: fileMeta.size,
          type: fileMeta.type,
        });
        const fileIndex = receiverFilesMeta.findIndex(
          (f) => f.fileId === fileMeta.fileId
        );
        cleanupWebRTCInstance(transferFileId);
        try {
          await startWebRTC({
            isSender: false,
            code: driveCode,
            fileIndex,
            filesRef: { current: receiverFilesMeta },
            peerConns,
            dataChannels,
            setError,
            driveCode,
            socket,
            sendSWMetaAndChunk,
            cleanupWebRTCInstance,
            makeFileId,
            fileId: transferFileId,
          });
        } catch (e) {
          console.error(
            `[App Receiver] Error calling startWebRTC for single file ${transferFileId}:`,
            e
          );
          setError(`Failed to start WebRTC for file ${fileMeta.name}.`);
          cleanupWebRTCInstance(transferFileId);
          setDownloadingFiles((prev) => {
            const s = new Set(prev);
            s.delete(fileMeta.fileId);
            return s;
          });
        }
        navigator.serviceWorker.removeEventListener("message", swHandler);
      }
    };
    navigator.serviceWorker.addEventListener("message", swHandler);
  };

  const {
    startZipProcess,
    isZipping,
    zipProgress,
    downloadSpeed,
    etr,
    error: zipError,
    zippingFolderPath,
    connectionStatus: zipConnectionStatus,
    currentOperationTotalSize,
  } = useZipDownload({
    receiverFilesMeta,
    driveCode,
    socket,
    cleanupWebRTCInstance,
    makeFileId,
    sendSWMetaAndChunk,
    handleDownloadRequest,
    peerConns,
    dataChannels,
    pendingSignals,
    handleSignal,
  });

  useEffect(() => {
    socket.on("signal", handleSignal);
    return () => {
      socket.off("signal", handleSignal);
    };
  }, [socket, handleSignal]);

  const handleDrop = (acceptedFiles) => {
    if (!acceptedFiles.length) return;
    const filesWithIds = acceptedFiles.map((f) => {
      let processedPath = f.path;
      if (processedPath) processedPath = processedPath.replace(/\\/g, "/");
      if (processedPath && processedPath.startsWith("./"))
        processedPath = processedPath.substring(2);
      if (processedPath)
        processedPath = processedPath.replace(/^\/+|\/+$/g, "");
      const finalPath = processedPath || f.name;
      return {
        name: f.name,
        size: f.size,
        type: f.type,
        file: f,
        fileId: makeFileId(),
        path: finalPath,
      };
    });
    const combinedFiles = [...filesRef.current, ...filesWithIds];
    setFiles(combinedFiles);
    const combinedFilesMeta = combinedFiles.map(
      ({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path,
      })
    );
    if (!driveCode) {
      console.log(
        "[App Sender] Creating a new drive. Cleaning up any existing WebRTC state."
      );
      Object.keys(peerConns.current).forEach(cleanupWebRTCInstance);
      pendingSignals.current = {};
      activeZipPcHeartbeats.current = {};

      let code = "";
      const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      for (let i = 0; i < 4; i++) {
        code += characters.charAt(
          Math.floor(Math.random() * characters.length)
        );
      }
      setDriveCode(code);
      const receiverUrl = `${window.location.origin}/${code}?as=receiver`;
      setQrValue(receiverUrl);
      socket.emit("create-room", code);
      setStep("uploaded");
      socket.emit("file-list", { room: code, filesMeta: combinedFilesMeta });
    } else {
      socket.emit("file-list", {
        room: driveCode,
        filesMeta: combinedFilesMeta,
      });
    }
  };

  useEffect(() => {
    const handler = ({ room }) => {
      const filesMeta = files.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path,
      }));
      socket.emit("file-list", { room, filesMeta });
    };
    socket.on("get-file-list", handler);
    return () => socket.off("get-file-list", handler);
  }, [files, socket]);

  useEffect(() => {
    if (!(driveCode && files.length > 0)) return;
    const handler = () => {
      const filesMeta = files.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path,
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    };
    socket.on("connect", handler);
    if (socket.connected) handler();
    return () => socket.off("connect", handler);
  }, [driveCode, files, socket]);

  useEffect(() => {
    if (!(driveCode && files.length > 0)) return;
    const interval = setInterval(() => {
      const filesMeta = files.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path,
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    }, 3000);
    return () => clearInterval(interval);
  }, [driveCode, files, socket]);

  useEffect(() => {
    const heartbeatHandler = (data) => {
      if (
        data &&
        data.pcId &&
        activeZipPcHeartbeats.current.hasOwnProperty(data.pcId)
      ) {
        activeZipPcHeartbeats.current[data.pcId] = Date.now();
        console.log(
          `[App Sender] Received and processed heartbeat for active zip PC: ${data.pcId}`
        );
      } else {
        console.warn(
          `[App Sender] Received heartbeat for unknown or inactive zip PC:`,
          data,
          "Current active keys:",
          Object.keys(activeZipPcHeartbeats.current)
        );
      }
    };
    socket.on("heartbeat-zip", heartbeatHandler);
    return () => socket.off("heartbeat-zip", heartbeatHandler);
  }, [socket]);

  useEffect(() => {
    const HEARTBEAT_TIMEOUT_MS = 90000;
    const CHECK_INTERVAL_MS = 15000;

    const intervalId = setInterval(() => {
      const now = Date.now();
      Object.keys(activeZipPcHeartbeats.current).forEach((pcId) => {
        const lastHeartbeatTime = activeZipPcHeartbeats.current[pcId];
        if (typeof lastHeartbeatTime === "number") {
          if (now - lastHeartbeatTime > HEARTBEAT_TIMEOUT_MS) {
            console.warn(
              `[App Sender] Zip PC ${pcId} heartbeat timeout. Last heartbeat was ${Math.round(
                (now - lastHeartbeatTime) / 1000
              )}s ago (threshold: ${
                HEARTBEAT_TIMEOUT_MS / 1000
              }s). Cleaning up.`
            );
            cleanupWebRTCInstance(pcId);
          }
        } else {
          console.warn(
            `[App Sender] Heartbeat check: pcId ${pcId} found in keys, but its timestamp was not a number:`,
            lastHeartbeatTime,
            ". Potentially already cleaned up or race condition."
          );
        }
      });
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [cleanupWebRTCInstance]);

  useEffect(() => {
    const downloadHandler = async ({
      fileId: requestedFileId,
      transferFileId,
      mainPcId,
      room,
      name,
      size,
      type,
      isZipRequest,
      isFolderRequest,
      folderPath,
    }) => {
      if (!socket.connected) {
        setError("Sender not connected to signaling server.");
        return;
      }
      const fileObj = filesRef.current.find(
        (f) => f.fileId === requestedFileId
      );
      if (!fileObj) {
        console.error(`File not found for download: ${requestedFileId}`);
        return;
      }
      const useTransferFileId = transferFileId || makeFileId();
      const fileIndex = filesRef.current.findIndex(
        (f) => f.fileId === fileObj.fileId
      );
      if (fileIndex === -1) {
        console.error(`File index not found for download: ${fileObj.fileId}`);
        return;
      }
      const pcIdToUse = mainPcId;

      if (isZipRequest || isFolderRequest) {
        if (!pcIdToUse) {
          console.error(
            `${isZipRequest ? "Zip" : "Folder"} request without mainPcId!`
          );
          return;
        }
        let pc = peerConns.current[pcIdToUse];
        let isNewPc = false;
        if (!pc) {
          isNewPc = true;
          try {
            const iceServersConfig = await getIceServers();
            pc = new window.RTCPeerConnection({ iceServers: iceServersConfig });
          } catch (e) {
            setError(`Sender: Failed to initialize WebRTC: ${e.message}`);
            return;
          }
          pc._associatedTransferIds = new Set();
          peerConns.current[pcIdToUse] = pc;
          activeZipPcHeartbeats.current[pcIdToUse] = Date.now();

          const iceConnectionTimeoutMs = 30000;
          const iceTimeoutId = setTimeout(() => {
            const currentPC = peerConns.current[pcIdToUse];
            if (
              currentPC &&
              currentPC.connectionState !== "connected" &&
              currentPC.connectionState !== "completed"
            ) {
              console.warn(
                `[App Sender Zip/Folder] PC ${pcIdToUse} ICE connection timed out after ${
                  iceConnectionTimeoutMs / 1000
                }s. State: ${currentPC.connectionState}. Cleaning up.`
              );
              setError(
                `Connection attempt timed out. Please check network and try again.`
              );
              cleanupWebRTCInstance(pcIdToUse);
            }
          }, iceConnectionTimeoutMs);
          pc._iceTimeoutId = iceTimeoutId;

          pc.onicecandidate = (event) => {
            if (event.candidate)
              socket.emit("signal", {
                room: driveCode,
                fileId: pcIdToUse,
                data: { candidate: event.candidate },
              });
          };
          pc.onicecandidateerror = (event) => {
            console.error(
              `[App Sender Zip/Folder] ICE candidate error for PC ${pcIdToUse}:`,
              event
            );
            if (event.errorCode) {
              const errorText = event.errorText || "No error text";
              console.error(
                `  Error Code: ${event.errorCode}, Host Candidate: ${event.hostCandidate}, Server URL: ${event.url}, Text: ${errorText}`
              );
            }
          };
          pc.onconnectionstatechange = () => {
            const currentPC = peerConns.current[pcIdToUse];
            if (!currentPC) return;

            console.log(
              `[App Sender Zip/Folder] PC ${pcIdToUse} connection state: ${currentPC.connectionState}. ICE: ${currentPC.iceConnectionState}, Signaling: ${currentPC.signalingState}`
            );
            if (
              currentPC.connectionState === "connected" ||
              currentPC.connectionState === "completed"
            ) {
              if (currentPC._iceTimeoutId)
                clearTimeout(currentPC._iceTimeoutId);
            }
            if (["failed", "closed"].includes(currentPC.connectionState)) {
              if (currentPC._iceTimeoutId)
                clearTimeout(currentPC._iceTimeoutId);
              console.warn(
                `[App Sender Zip/Folder] PC ${pcIdToUse} connection ${currentPC.connectionState}. Cleaning up.`
              );
              cleanupWebRTCInstance(pcIdToUse);
            }
          };
          pc.onsignalingstatechange = () => {
            const currentPC = peerConns.current[pcIdToUse];
            if (!currentPC) return;
            console.log(
              `[App Sender Zip/Folder] PC ${pcIdToUse} signaling state: ${currentPC.signalingState}. ICE: ${currentPC.iceConnectionState}, Connection: ${currentPC.connectionState}`
            );
          };
          if (pendingSignals.current[pcIdToUse]) {
            pendingSignals.current[pcIdToUse].forEach((signalData) =>
              handleSignal({ fileId: pcIdToUse, ...signalData })
            );
            delete pendingSignals.current[pcIdToUse];
          }
        }
        const dc = pc.createDataChannel(useTransferFileId);
        dc.binaryType = "arraybuffer";
        dataChannels.current[useTransferFileId] = dc;
        if (peerConns.current[pcIdToUse]?._associatedTransferIds) {
          peerConns.current[pcIdToUse]._associatedTransferIds.add(
            useTransferFileId
          );
        }
        dc.onopen = () => {
          dc.send(`META:${fileObj.name}:${fileObj.size}`);
          const chunkSize = 256 * 1024;
          let offset = 0;
          const MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024;
          dc.bufferedAmountLowThreshold = 2 * 1024 * 1024;
          function sendChunk() {
            if (offset < fileObj.size) {
              if (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                dc.onbufferedamountlow = () => {
                  dc.onbufferedamountlow = null;
                  Promise.resolve().then(sendChunk);
                };
                return;
              }
              const slice = fileObj.file.slice(
                offset,
                offset + Math.min(chunkSize, fileObj.size - offset)
              );
              const reader = new FileReader();
              reader.onload = (e) => {
                try {
                  if (dc.readyState === "open") {
                    dc.send(e.target.result);
                    offset += e.target.result.byteLength;
                    Promise.resolve().then(sendChunk);
                  } else {
                    delete dataChannels.current[useTransferFileId];
                  }
                } catch (err) {
                  delete dataChannels.current[useTransferFileId];
                }
              };
              reader.onerror = () => {
                delete dataChannels.current[useTransferFileId];
              };
              reader.readAsArrayBuffer(slice);
            } else {
              dc.send("EOF:" + fileObj.name);
            }
          }
          sendChunk();
        };
        dc.onerror = (event) => {
          const errorDetail = event.error
            ? `RTCError: ${event.error.message || "No message"}. Detail: ${
                event.error.errorDetail || "N/A"
              }. SCTP Cause: ${
                event.error.sctpCauseCode || "N/A"
              }. HTTP Status: ${
                event.error.httpRequestStatusCode || "N/A"
              }. SDP Line: ${
                event.error.sdpLineNumber || "N/A"
              }. Received Alert: ${
                event.error.receivedAlert || "N/A"
              }. Sent Alert: ${event.error.sentAlert || "N/A"}.`
            : "Unknown DataChannel error";
          console.error(
            `[App Sender Zip/Folder] DataChannel error for transferId: ${useTransferFileId}, file: ${fileObj.name}. Event:`,
            event,
            "Parsed Details:",
            errorDetail
          );
          setError(
            `Sender: DataChannel error for ${fileObj.name}. Details: ${
              event.error?.errorDetail || "Connection issue"
            }`
          );
          delete dataChannels.current[useTransferFileId];
        };
        dc.onclose = () => {
          console.log(
            `[App Sender Zip/Folder] DataChannel closed for transferId: ${useTransferFileId}, file: ${fileObj.name}`
          );
          delete dataChannels.current[useTransferFileId];
        };
        if (isNewPc) {
          pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => {
              if (pc.localDescription)
                socket.emit("signal", {
                  room: driveCode,
                  fileId: pcIdToUse,
                  data: { sdp: pc.localDescription },
                });
              else {
                setError("Sender: Failed to set local description.");
                cleanupWebRTCInstance(pcIdToUse);
              }
            })
            .catch((e) => {
              setError(`Sender: Failed to create offer: ${e.message}`);
              cleanupWebRTCInstance(pcIdToUse);
            });
        }
      } else {
        try {
          await startWebRTC({
            isSender: true,
            code: driveCode,
            fileIndex,
            filesRef,
            peerConns,
            dataChannels,
            setError,
            driveCode,
            socket,
            sendSWMetaAndChunk,
            cleanupWebRTCInstance,
            makeFileId,
            fileId: useTransferFileId,
          });
        } catch (e) {
          console.error(
            `[App Sender] Error calling startWebRTC for single file ${useTransferFileId}:`,
            e
          );
          setError(`Failed to start WebRTC for file ${fileObj.name}.`);
          cleanupWebRTCInstance(useTransferFileId);
        }
      }
    };
    socket.on("download-file", downloadHandler);
    return () => socket.off("download-file", downloadHandler);
  }, [
    socket,
    driveCode,
    handleSignal,
    cleanupWebRTCInstance,
    sendSWMetaAndChunk,
  ]);

  useEffect(() => {
    if (step === "receiver" && driveCode) {
      if (
        driveCode !== prevDriveCodeRef.current ||
        prevStepRef.current !== "receiver"
      ) {
        console.log(
          `[App Receiver] Joining new drive ${driveCode} or switching to receiver step. Cleaning up ALL existing WebRTC instances.`
        );
        Object.keys(peerConns.current).forEach(cleanupWebRTCInstance);
        Object.keys(dataChannels.current).forEach((dcId) => {
          let isAssociated = peerConns.current[dcId];
          if (!isAssociated) {
            for (const pc of Object.values(peerConns.current)) {
              if (
                pc &&
                pc._associatedTransferIds &&
                pc._associatedTransferIds.has(dcId)
              ) {
                isAssociated = true;
                break;
              }
            }
          }
          if (!isAssociated && dataChannels.current[dcId]) {
            console.log(
              `[App Receiver] Cleaning up potentially orphaned dataChannel: ${dcId}`
            );
            try {
              if (dataChannels.current[dcId].readyState !== "closed")
                dataChannels.current[dcId].close();
            } catch (e) {
              /*ignore*/
            }
            delete dataChannels.current[dcId];
          }
        });
        pendingSignals.current = {};
        activeZipPcHeartbeats.current = {};
        console.log(
          "[App Receiver] Finished cleanup for new drive/receiver step."
        );
      }
      prevDriveCodeRef.current = driveCode;
      const joinAndRequest = () => {
        socket.emit("join-room", driveCode);
        socket.emit("get-file-list", { room: driveCode });
      };
      if (socket.connected) joinAndRequest();
      socket.on("connect", joinAndRequest);
      return () => socket.off("connect", joinAndRequest);
    } else {
      prevDriveCodeRef.current = null;
    }
  }, [step, driveCode, socket, cleanupWebRTCInstance]);

  useEffect(() => {
    const handler = ({ filesMeta }) =>
      setReceiverFilesMeta(Array.isArray(filesMeta) ? filesMeta : []);
    socket.on("file-list", handler);
    return () => socket.off("file-list", handler);
  }, [socket]);

  useEffect(() => {
    const handler = (event) => {
      if (event.data && event.data.done && event.data.fileId) {
        setDownloadingFiles((prev) => {
          const s = new Set(prev);
          s.delete(event.data.fileId);
          return s;
        });
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    const handler = (event) => {
      if (event.data.type === "download-ready")
        window.open(event.data.url, "_blank");
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      let needsConfirmation =
        (step === "uploaded" && files.length > 0) ||
        (step === "receiver" && isZipping);
      if (needsConfirmation) {
        const msg =
          step === "uploaded"
            ? "Leaving will stop sharing."
            : "Leaving will interrupt download/zip.";
        event.preventDefault();
        event.returnValue = msg;
        return msg;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [step, files.length, isZipping]);

  function isDownloading(fileId) {
    return downloadingFiles.has(fileId);
  }

  const handleDeleteFile = (fileId) => {
    const newFiles = files.filter((f) => f.fileId !== fileId);
    setFiles(newFiles);
    if (driveCode) {
      const filesMeta = newFiles.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path,
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    }
  };

  const handleDeleteFolder = (folderPath) => {
    const pathPrefix = folderPath + "/";
    const newFiles = filesRef.current.filter(
      (f) =>
        !(f.path === folderPath || (f.path && f.path.startsWith(pathPrefix)))
    );
    if (newFiles.length === filesRef.current.length) return;
    setFiles(newFiles);
    if (driveCode) {
      const filesMeta = newFiles.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path,
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    }
  };

  const handleDownloadFolder = (folderPath) => {
    setError("");
    startZipProcess(folderPath);
  };

  const handleJoinDrive = (codeToJoin) => {
    setError("");
    setIsJoiningDrive(true);
    const upperCode = codeToJoin.toUpperCase().replace(/[^A-Z]/g, "");
    if (upperCode && upperCode.length === 4 && /^[A-Z]+$/.test(upperCode)) {
      setTimeout(() => {
        window.location.href = `/${upperCode}?as=receiver`;
      }, 500);
    } else {
      setError("Invalid drive code. Must be 4 uppercase letters.");
      setJoinDriveCodeInput("");
      setIsJoiningDrive(false);
    }
  };

  const handleCopy = (textToCopy) => {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
        setShowToast(true);
        toastTimeoutRef.current = setTimeout(() => setShowToast(false), 2000);
      })
      .catch((err) => console.error("Failed to copy text: ", err));
  };

  function formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024)
      return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }

  function formatEtr(seconds) {
    if (
      seconds === null ||
      seconds === Infinity ||
      seconds < 0 ||
      isNaN(seconds)
    )
      return "--:--";
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
    if (minutes > 0) return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
    return `${secs}s`;
  }

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  const AppHeader = () => (
    <div className="app-header">
      <div
        className="website-name"
        onClick={() => (window.location.href = "/")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          className="website-logo-icon"
        >
          <path
            d="M24 24C24 24 18.522 34 13 34C7.478 34 4 29.522 4 24C4 18.478 7.478 14 13 14C18.522 14 24 24 24 24ZM24 24C24 24 29.478 34 35 34C40.522 34 44 29.522 44 24C44 18.478 40.522 14 35 14C29.478 14 24 24 24 24Z"
            stroke="#24A094"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="website-name-text">InfinityShare</span>
      </div>
      <div className="header-icons-right">
        <div
          className="home-link header-icon-link"
          onClick={() => (window.location.href = "/")}
          title="Home"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="48px"
            viewBox="0 0 24 24"
            width="48px"
            fill="#000000"
            className="home-icon header-icon-svg"
          >
            <path d="M0 0h24v24H0V0z" fill="none" />
            <path d="M10 19v-5h4v5c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-7h1.7c.46 0 .68-.57.33-.87L12.67 3.6c-.38-.34-.96-.34-1.34 0l-8.36 7.53c-.34.3-.13.87.33.87H5v7c0 .55.45 1 1 1h3c.55 0 1-.45 1-1z" />
          </svg>
        </div>
        <a
          href="https://github.com/Shanmus4/infinityshare"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link header-icon-link"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="48px"
            viewBox="0 0 24 24"
            width="48px"
            fill="#000000"
            className="github-icon header-icon-svg"
          >
            <path d="M12 1.27a11 11 0 00-3.48 21.46c.55.1.73-.24.73-.53v-1.84c-3.03.65-3.67-1.46-3.67-1.46a2.89 2.89 0 00-1.21-1.58c-.99-.68.08-.66.08-.66a2.29 2.29 0 011.66 1.12 2.33 2.33 0 003.19.91 2.32 2.32 0 01.68-1.45c-2.43-.28-4.98-1.22-4.98-5.42a4.25 4.25 0 011.11-2.91 3.93 3.93 0 01.11-2.88s.92-.3 3 1.12a10.3 10.3 0 015.44 0c2.08-1.42 3-1.12 3-1.12a3.93 3.93 0 01.11 2.88 4.25 4.25 0 011.11 2.91c0 4.21-2.55 5.14-4.99 5.42a2.58 2.58 0 01.73 2v2.92c0 .29.18.63.73.53A11 11 0 0012 1.27z" />
          </svg>
        </a>
      </div>
    </div>
  );

  const openInstructionsModal = () => {
    setShowWhyModal(false);
    setShowInstructionsModal(true);
  };

  const openWhyModal = () => {
    setShowInstructionsModal(false);
    setShowWhyModal(true);
  };

  if (step === "init") {
    return (
      <>
        <AppHeader />
        <div className="main-section">
          <div className="content-div">
            <div className="send-receive-div">
              <div className="subhead">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="black"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.9136 13.0852C10.7224 12.8945 10.4947 12.7444 10.244 12.644L2.31399 9.46399C2.21931 9.426 2.13851 9.35996 2.08245 9.27472C2.02638 9.18949 1.99773 9.08914 2.00035 8.98715C2.00296 8.88517 2.03671 8.78642 2.09706 8.70417C2.15741 8.62191 2.24148 8.56009 2.33799 8.527L21.338 2.027C21.4266 1.99499 21.5225 1.98888 21.6144 2.00939C21.7064 2.02989 21.7906 2.07616 21.8572 2.14277C21.9238 2.20939 21.9701 2.2936 21.9906 2.38555C22.0111 2.4775 22.005 2.57339 21.973 2.662L15.473 21.662C15.4399 21.7585 15.3781 21.8426 15.2958 21.9029C15.2136 21.9633 15.1148 21.997 15.0128 21.9996C14.9108 22.0022 14.8105 21.9736 14.7253 21.9175C14.64 21.8615 14.574 21.7807 14.536 21.686L11.356 13.754C11.2552 13.5035 11.1047 13.276 10.9136 13.0852ZM10.9136 13.0852L21.854 2.147" />
                </svg>
                <span className="subhead-text">Send</span>
              </div>
              <DropzoneArea onDrop={handleDrop}>
                <div className="dropzone-internal-content">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="48"
                    height="48"
                    viewBox="0 0 48 48"
                    fill="none"
                    className="dropzone-icon"
                  >
                    <path
                      d="M16 38H14C9 38 6 34 6 30C6 26 9 22 14 22C16 22 17 23 17 23M32 38H34C39 38 42 34 42 30C42 26 39 22 34 22C32 22 31 23 31 23"
                      stroke="black"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M14 22V20C14 15 18 10 24 10C30 10 34 15 34 20V22"
                      stroke="black"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M24 40V28"
                      stroke="black"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M28 30L24 26L20 30"
                      stroke="black"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="dropzone-text">
                    Drag & Drop files here, or click here to select files
                  </span>
                </div>
              </DropzoneArea>
            </div>
            <div className="send-receive-div">
              <div className="subhead">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="black"
                >
                  <path d="M4.125 21C3.42881 21 2.76113 20.7234 2.26884 20.2312C1.77656 19.7389 1.5 19.0712 1.5 18.375V14.625C1.5 14.3266 1.61853 14.0405 1.8295 13.8295C2.04048 13.6185 2.32663 13.5 2.625 13.5C2.92337 13.5 3.20952 13.6185 3.4205 13.8295C3.63147 14.0405 3.75 14.3266 3.75 14.625V18.375C3.75 18.582 3.918 18.75 4.125 18.75H19.875C19.9745 18.75 20.0698 18.7105 20.1402 18.6402C20.2105 18.5698 20.25 18.4745 20.25 18.375V14.625C20.25 14.3266 20.3685 14.0405 20.5795 13.8295C20.7905 13.6185 21.0766 13.5 21.375 13.5C21.6734 13.5 21.9595 13.6185 22.1705 13.8295C22.3815 14.0405 22.5 14.3266 22.5 14.625V18.375C22.5 19.0712 22.2234 19.7389 21.7312 20.2312C21.2389 20.7234 20.5712 21 19.875 21H4.125Z" />
                  <path d="M10.875 11.5335V3C10.875 2.70163 10.9935 2.41548 11.2045 2.2045C11.4155 1.99353 11.7016 1.875 12 1.875C12.2984 1.875 12.5845 1.99353 12.7955 2.2045C13.0065 2.41548 13.125 2.70163 13.125 3V11.5335L16.08 8.58C16.1844 8.4756 16.3083 8.39278 16.4448 8.33628C16.5812 8.27978 16.7274 8.2507 16.875 8.2507C17.0226 8.2507 17.1688 8.27978 17.3053 8.33628C17.4417 8.39278 17.5656 8.4756 17.67 8.58C17.7744 8.6844 17.8572 8.80834 17.9137 8.94475C17.9702 9.08116 17.9993 9.22736 17.9993 9.375C17.9993 9.52264 17.9702 9.66884 17.9137 9.80525C17.8572 9.94166 17.7744 10.0656 17.67 10.17L12.795 15.045C12.5841 15.2557 12.2981 15.374 12 15.374C11.7019 15.374 11.4159 15.2557 11.205 15.045L6.33 10.17C6.2256 10.0656 6.14279 9.94166 6.08628 9.80525C6.02978 9.66884 6.0007 9.52264 6.0007 9.375C6.0007 9.22736 6.02978 9.08116 6.08628 8.94475C6.14279 8.80834 6.2256 8.6844 6.33 8.58C6.4344 8.4756 6.55834 8.39278 6.69475 8.33628C6.83116 8.27978 6.97736 8.2507 7.125 8.2507C7.27265 8.2507 7.41885 8.27978 7.55525 8.33628C7.69166 8.39278 7.8156 8.4756 7.92 8.58L10.875 11.5335Z" />
                </svg>
                <span className="subhead-text">Receive</span>
              </div>
              <div className="receive-subcontainer">
                <input
                  type="text"
                  className="drive-code-input"
                  placeholder="Enter 4 character drive code"
                  value={joinDriveCodeInput}
                  onChange={(e) =>
                    setJoinDriveCodeInput(
                      e.target.value.toUpperCase().replace(/[^A-Z]/g, "")
                    )
                  }
                  maxLength={4}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleJoinDrive(joinDriveCodeInput);
                  }}
                />
                <button
                  className={`join-drive-button ${
                    isJoiningDrive ? "loading" : ""
                  }`}
                  onClick={() => handleJoinDrive(joinDriveCodeInput)}
                  disabled={isJoiningDrive}
                >
                  {isJoiningDrive ? "Joining..." : "Join Drive"}
                </button>
              </div>
              {error && (
                <div className="error-subcontainer">
                  <div className="error-field">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="error-icon"
                    >
                      <path
                        d="M12 17C12.2833 17 12.521 16.904 12.713 16.712C12.905 16.52 13.0007 16.2827 13 16C12.9993 15.7173 12.9033 15.48 12.712 15.288C12.5207 15.096 12.2833 15 12 15C11.7167 15 11.4793 15.096 11.288 15.288C11.0967 15.48 11.0007 15.7173 11 16C10.9993 16.2827 11.0953 16.5203 11.288 16.713C11.4807 16.9057 11.718 17.0013 12 17ZM11 13H13V7H11V13ZM12 22C10.6167 22 9.31667 21.7373 8.1 21.212C6.88334 20.6867 5.825 19.9743 4.925 19.075C4.025 18.1757 3.31267 17.1173 2.788 15.9C2.26333 14.6827 2.00067 13.3827 2 12C1.99933 10.6173 2.262 9.31733 2.788 8.1C3.314 6.88267 4.02633 5.82433 4.925 4.925C5.82367 4.02567 6.882 3.31333 8.1 2.788C9.318 2.26267 10.618 2 12 2C13.382 2 14.682 2.26267 15.9 2.788C17.118 3.31333 18.1763 4.02567 19.075 4.925C19.9737 5.82433 20.6863 6.88267 21.213 8.1C21.7397 9.31733 22.002 10.6173 22 12C21.998 13.3827 21.7353 14.6827 21.212 15.9C20.6887 17.1173 19.9763 18.1757 19.075 19.075C18.1737 19.9743 17.1153 20.687 15.9 21.213C14.6847 21.739 13.3847 22.0013 12 22ZM12 20C14.2333 20 16.125 19.225 17.675 17.675C19.225 16.125 20 14.2333 20 12C20 9.76667 19.225 7.875 17.675 6.325C16.125 4.775 14.2333 4 12 4C9.76667 4 7.875 4.775 6.325 6.325C4.775 7.875 4 9.76667 4 12C4 14.2333 4.775 16.125 6.325 17.675C7.875 19.225 9.76667 20 12 20Z"
                        fill="#98282A"
                      />
                    </svg>
                    <span className="error-text">{error}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="instructions-container">
              <div className="instruction-div" onClick={openInstructionsModal}>
                <span className="instruction-text">Instructions</span>
                <svg
                  className="instruction-arrow"
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M9.5 6L15.5 12L9.5 18"
                    stroke="black"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="instruction-div" onClick={openWhyModal}>
                <span className="instruction-text">Why InfinityShare</span>
                <svg
                  className="instruction-arrow"
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M9.5 6L15.5 12L9.5 18"
                    stroke="black"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
            <Modal
              show={showInstructionsModal}
              onClose={() => setShowInstructionsModal(false)}
              title="How to Use InfinityShare"
            >
              <div className="modal-list">
                
                <ul>
                  <ul>
                    <li>
                      <strong>Connect Devices:</strong> Make sure both devices
                      are on the same Wi-Fi or mobile hotspot.
                    </li>
                    <li>
                      <strong>Send & Share:</strong> Upload your file, then
                      share the QR code, link, or code with the other device.
                    </li>
                    <li>
                      <strong>Keep Tabs Open:</strong> Don’t close the tab on
                      any device during the transfer.
                    </li>
                    <li>
                      <strong>Install App (Optional):</strong>
                      <ul>
                        <li>
                          <strong>Desktop:</strong> Click the install icon in
                          the address bar.
                        </li>
                        <li>
                          <strong>Android:</strong> Tap the menu (⋮) → “Install
                          app.”
                        </li>
                        <li>
                          <strong>iOS (Safari only):</strong> Tap the Share icon
                          → “Add to Home Screen.”
                        </li>
                      </ul>
                    </li>
                  </ul>
                </ul>
              </div>
            </Modal>
            <Modal
              show={showWhyModal}
              onClose={() => setShowWhyModal(false)}
              title="Why Choose InfinityShare?"
            >
              <div className="modal-list">
                <ul>
                  <li>
                    <strong>No Uploads, Unlimited Size:</strong> Direct P2P
                    transfer, no server storage.
                  </li>
                  <li>
                    <strong>Safe and Secure:</strong> Encrypted transfers, files
                    never touch our servers.
                  </li>
                  <li>
                    <strong>Temporary & Direct Links:</strong> Links active only
                    while sender's tab is open.
                  </li>
                  <li>
                    <strong>Fast Transfers:</strong> Quicker than
                    upload/download, especially locally.
                  </li>
                  <li>
                    <strong>Folder Support:</strong> Share entire folders
                    easily.
                  </li>
                  <li>
                    <strong>Cross-Platform & PWA:</strong> Works on modern
                    browsers, installable as an app.
                  </li>
                </ul>
                <p>
                  For more information, visit my{" "}
                  <a
                    href="https://github.com/Shanmus4/infinityshare"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub repository
                  </a>
                  .
                </p>
              </div>
            </Modal>
            <div className="copyright-text">
              © {new Date().getFullYear()} Shanmu. All Rights Reserved.
              Developed using Gemini 2.5 Pro. 🤖
            </div>
          </div>
        </div>
      </>
    );
  }

  if (step === "uploaded") {
    const receiverUrl = `${window.location.origin}/${driveCode}?as=receiver`;
    return (
      <>
        <AppHeader />
        <div className="main-section">
          <div className="content-div">
            <div className="append-div">
              <div className="info-for-user">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="25"
                  viewBox="0 0 24 25"
                  fill="none"
                  className="info-icon"
                >
                  <path
                    d="M10.875 17.375C10.875 17.6734 10.9935 17.9595 11.2045 18.1705C11.4155 18.3815 11.7016 18.5 12 18.5C12.2984 18.5 12.5845 18.3815 12.7955 18.1705C13.0065 17.9595 13.125 17.6734 13.125 17.375C13.125 17.0766 13.0065 16.7905 12.7955 16.5795C12.5845 16.3685 12.2984 16.25 12 16.25C11.7016 16.25 11.4155 16.3685 11.2045 16.5795C10.9935 16.7905 10.875 17.0766 10.875 17.375ZM11.25 10.25V14.5625C11.25 14.6656 11.3344 14.75 11.4375 14.75H12.5625C12.6656 14.75 12.75 14.6656 12.75 14.5625V10.25C12.75 10.1469 12.6656 10.0625 12.5625 10.0625H11.4375C11.3344 10.0625 11.25 10.1469 11.25 10.25ZM22.3992 20.5625L12.6492 3.6875C12.5039 3.43672 12.2531 3.3125 12 3.3125C11.7469 3.3125 11.4937 3.43672 11.3508 3.6875L1.60078 20.5625C1.3125 21.0641 1.67344 21.6875 2.25 21.6875H21.75C22.3266 21.6875 22.6875 21.0641 22.3992 20.5625ZM4.03594 19.9086L12 6.12266L19.9641 19.9086H4.03594Z"
                    fill="#6F5700"
                  />
                </svg>
                <span className="info-text">
                  Keep the tab open to transfer files. Closing the tab will
                  result in closing of the drive!
                </span>
              </div>
              <div className="send-receive-div">
                <DropzoneArea onDrop={handleDrop} className="dropzone-append">
                  <div className="dropzone-internal-content">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="48"
                      height="48"
                      viewBox="0 0 48 48"
                      fill="none"
                      className="dropzone-icon"
                    >
                      <path
                        d="M16 38H14C9 38 6 34 6 30C6 26 9 22 14 22C16 22 17 23 17 23M32 38H34C39 38 42 34 42 30C42 26 39 22 34 22C32 22 31 23 31 23"
                        stroke="black"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M14 22V20C14 15 18 10 24 10C30 10 34 15 34 20V22"
                        stroke="black"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M24 40V28"
                        stroke="black"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M28 30L24 26L20 30"
                        stroke="black"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="dropzone-text">
                      Add more files to the drive
                    </span>
                  </div>
                </DropzoneArea>
              </div>
            </div>
            <div className="sharing-info-section">
              <div className="link-details">
                <div className="qr-code-container">
                  <QRCodeBlock receiverUrl={receiverUrl} />
                </div>
                <div className="link-details-right-div">
                  <div className="subcontainer-padding">
                    <span className="drive-link-text">{receiverUrl}</span>
                    <button
                      className="copy-button"
                      onClick={() => handleCopy(receiverUrl)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="32"
                        height="33"
                        viewBox="0 0 32 33"
                        fill="none"
                      >
                        <path
                          d="M20 27.1666H6.66667V9.83329C6.66667 9.09996 6.06667 8.49996 5.33333 8.49996C4.6 8.49996 4 9.09996 4 9.83329V27.1666C4 28.6333 5.2 29.8333 6.66667 29.8333H20C20.7333 29.8333 21.3333 29.2333 21.3333 28.5C21.3333 27.7666 20.7333 27.1666 20 27.1666ZM26.6667 21.8333V5.83329C26.6667 4.36663 25.4667 3.16663 24 3.16663H12C10.5333 3.16663 9.33333 4.36663 9.33333 5.83329V21.8333C9.33333 23.3 10.5333 24.5 12 24.5H24C25.4667 24.5 26.6667 23.3 26.6667 21.8333ZM24 21.8333H12V5.83329H24V21.8333Z"
                          fill="black"
                        />
                      </svg>
                    </button>
                  </div>
                  <div className="drive-code-display-div">
                    <span className="drive-code-label">Drive Code</span>
                    <span className="drive-code-value">{driveCode}</span>
                  </div>
                </div>
              </div>
              <FileList
                files={files}
                onDelete={handleDeleteFile}
                onDeleteFolder={handleDeleteFolder}
                isSender={true}
              />
            </div>
          </div>
          <div className={`toast-snackbar ${showToast ? "show" : ""}`}>
            <svg
              className="toast-snackbar-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"></path>
            </svg>
            Link Copied!
          </div>
          <div className="copyright-text">
            © {new Date().getFullYear()} Shanmu. All Rights Reserved. Developed
            using Gemini 2.5 Pro. 🤖
          </div>
        </div>
      </>
    );
  }

  if (step === "receiver") {
    const isDownloadAllDisabled = receiverFilesMeta.length === 0 || isZipping;
    return (
      <>
        <AppHeader />
        <div className="main-section">
          <div className="content-div">
            <div className="sharing-info-section receiver-view-container">
              <div className="receiver-top-div">
                <div className="drive-code-display-div">
                  <span className="drive-code-label">Drive Code</span>
                  <span className="drive-code-value">{driveCode}</span>
                </div>
                <button
                  className={`join-drive-button download-all-button ${
                    isDownloadAllDisabled ? "disabled" : ""
                  }`}
                  onClick={() => startZipProcess()}
                  disabled={isDownloadAllDisabled}
                >
                  {isZipping && !zippingFolderPath
                    ? `Downloading... (${zipProgress.toFixed(0)}%)`
                    : "Download All"}
                </button>
              </div>
              {(error || zipError) && (
                <div
                  className="error-subcontainer receiver-error-subcontainer"
                  style={{ marginBottom: "16px" }}
                >
                  <div className="error-field">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="error-icon"
                    >
                      <path
                        d="M12 17C12.2833 17 12.521 16.904 12.713 16.712C12.905 16.52 13.0007 16.2827 13 16C12.9993 15.7173 12.9033 15.48 12.712 15.288C12.5207 15.096 12.2833 15 12 15C11.7167 15 11.4793 15.096 11.288 15.288C11.0967 15.48 11.0007 15.7173 11 16C10.9993 16.2827 11.0953 16.5203 11.288 16.713C11.4807 16.9057 11.718 17.0013 12 17ZM11 13H13V7H11V13ZM12 22C10.6167 22 9.31667 21.7373 8.1 21.212C6.88334 20.6867 5.825 19.9743 4.925 19.075C4.025 18.1757 3.31267 17.1173 2.788 15.9C2.26333 14.6827 2.00067 13.3827 2 12C1.99933 10.6173 2.262 9.31733 2.788 8.1C3.314 6.88267 4.02633 5.82433 4.925 4.925C5.82367 4.02567 6.882 3.31333 8.1 2.788C9.318 2.26267 10.618 2 12 2C13.382 2 14.682 2.26267 15.9 2.788C17.118 3.31333 18.1763 4.02567 19.075 4.925C19.9737 5.82433 20.6863 6.88267 21.213 8.1C21.7397 9.31733 22.002 10.6173 22 12C21.998 13.3827 21.7353 14.6827 21.212 15.9C20.6887 17.1173 19.9763 18.1757 19.075 19.075C18.1737 19.9743 17.1153 20.687 15.9 21.213C14.6847 21.739 13.3847 22.0013 12 22ZM12 20C14.2333 20 16.125 19.225 17.675 17.675C19.225 16.125 20 14.2333 20 12C20 9.76667 19.225 7.875 17.675 6.325C16.125 4.775 14.2333 4 12 4C9.76667 4 7.875 4.775 6.325 6.325C4.775 7.875 4 9.76667 4 12C4 14.2333 4.775 16.125 6.325 17.675C7.875 19.225 9.76667 20 12 20Z"
                        fill="#98282A"
                      />
                    </svg>
                    <span className="error-text">{error || zipError}</span>
                  </div>
                </div>
              )}
              {isZipping && (
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                  }}
                >
                  <div className="info-for-user receiver-info-zipping">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="25"
                      viewBox="0 0 24 25"
                      fill="none"
                      className="info-icon"
                    >
                      <path
                        d="M10.875 17.375C10.875 17.6734 10.9935 17.9595 11.2045 18.1705C11.4155 18.3815 11.7016 18.5 12 18.5C12.2984 18.5 12.5845 18.3815 12.7955 18.1705C13.0065 17.9595 13.125 17.6734 13.125 17.375C13.125 17.0766 13.0065 16.7905 12.7955 16.5795C12.5845 16.3685 12.2984 16.25 12 16.25C11.7016 16.25 11.4155 16.3685 11.2045 16.5795C10.9935 16.7905 10.875 17.0766 10.875 17.375ZM11.25 10.25V14.5625C11.25 14.6656 11.3344 14.75 11.4375 14.75H12.5625C12.6656 14.75 12.75 14.6656 12.75 14.5625V10.25C12.75 10.1469 12.6656 10.0625 12.5625 10.0625H11.4375C11.3344 10.0625 11.25 10.1469 11.25 10.25ZM22.3992 20.5625L12.6492 3.6875C12.5039 3.43672 12.2531 3.3125 12 3.3125C11.7469 3.3125 11.4937 3.43672 11.3508 3.6875L1.60078 20.5625C1.3125 21.0641 1.67344 21.6875 2.25 21.6875H21.75C22.3266 21.6875 22.6875 21.0641 22.3992 20.5625ZM4.03594 19.9086L12 6.12266L19.9641 19.9086H4.03594Z"
                        fill="#6F5700"
                      />
                    </svg>
                    <span className="info-text">
                      The files you requested are downloading and getting
                      zipped. Please do not close or refresh the page while this
                      process is active.
                    </span>
                  </div>
                  <div className="progress-display-container">
                    <div className="progress-filename-text">
                      {zippingFolderPath
                        ? `Downloading and Zipping: ${zippingFolderPath
                            .split("/")
                            .pop()}.zip`
                        : "Downloading and Zipping All Files..."}
                      {isZipping && currentOperationTotalSize > 0 && (
                        <>
                          {" "}
                          {" ("}
                          <span style={{ color: "#24A094" }}>
                            {formatBytes(
                              (zipProgress / 100) * currentOperationTotalSize,
                              1
                            )}
                          </span>
                          {" / "}
                          {formatBytes(currentOperationTotalSize, 1)}
                          {")"}
                        </>
                      )}
                    </div>
                    {zipConnectionStatus === "interrupted" && (
                      <div className="progress-info-text connection-status-info">
                        {zipError ||
                          "Connection interrupted, waiting for sender..."}
                      </div>
                    )}
                    {zipConnectionStatus !== "failed" && (
                      <>
                        <div className="progress-bar-wrapper">
                          <div
                            className="progress-bar-fill"
                            style={{ width: `${zipProgress}%` }}
                          ></div>
                          <div className="progress-bar-text">
                            {zipProgress.toFixed(1)}%
                          </div>
                        </div>
                        <div className="progress-stats-container">
                          <span>
                            Speed:{" "}
                            <span className="stat-value">
                              {zipConnectionStatus === "interrupted"
                                ? "--"
                                : formatSpeed(downloadSpeed)}
                            </span>
                          </span>
                          <span>
                            ETA:{" "}
                            <span className="stat-value">
                              {zipConnectionStatus === "interrupted"
                                ? "--"
                                : formatEtr(etr)}
                            </span>
                          </span>
                        </div>
                        <div className="progress-info-text">
                          {zipConnectionStatus === "interrupted"
                            ? "Download will attempt to resume if sender reconnects."
                            : "Please wait, the download will start automatically when zipping is complete."}
                        </div>
                      </>
                    )}
                    {zipConnectionStatus === "failed" && zipError && (
                      <div className="progress-info-text error-text">
                        {zipError}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <FileList
                files={receiverFilesMeta}
                onDownload={handleDownloadRequest}
                isSender={false}
                isDownloading={isDownloading}
                onDownloadFolder={handleDownloadFolder}
                isZipping={isZipping}
                setError={setError}
              />
            </div>
            <div className="copyright-text">
              © {new Date().getFullYear()} Shanmu. All Rights Reserved.
              Developed using Gemini 2.5 Pro. 🤖
            </div>
          </div>
        </div>
      </>
    );
  }

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      let needsConfirmation =
        (step === "uploaded" && files.length > 0) ||
        (step === "receiver" && isZipping);
      if (needsConfirmation) {
        const msg =
          step === "uploaded"
            ? "Leaving will stop sharing."
            : "Leaving will interrupt download/zip.";
        event.preventDefault();
        event.returnValue = msg;
        return msg;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [step, files.length, isZipping]);

  useEffect(() => {
    if (step === "receiver" && driveCode) {
      setStep("receiver");
    }
  }, [step, driveCode]);

  useEffect(() => {
    const pathDriveCode = window.location.pathname.slice(1).toUpperCase();
    const asReceiver =
      new URLSearchParams(window.location.search).get("as") === "receiver";
    if (
      step === "init" &&
      pathDriveCode.length === 4 &&
      /^[A-Z]+$/.test(pathDriveCode) &&
      !asReceiver
    ) {
      setDriveCode(pathDriveCode);
    }
  }, [step]);

  return null;
}

export default App;
