import React, { useState, useRef, useEffect } from "react";
import FileList from "./components/FileList";
import DropzoneArea from "./components/DropzoneArea";
import QRCodeBlock from "./components/QRCodeBlock";
// import DriveLinkBlock from "./components/DriveLinkBlock"; // Removed import
// import ErrorBanner from "./components/ErrorBanner"; // Removed for receiver
import { useSocket } from "./hooks/useSocket";
import { useServiceWorker } from "./hooks/useServiceWorker";
import { startWebRTC } from "./hooks/useWebRTC"; // For single file downloads
// import { startZipSenderConnection } from "./utils/startZipSenderConnection"; // REMOVED - Logic integrated into App.js downloadHandler
// setupZipReceiverConnection is used inside useZipDownload now
import { makeFileId } from "./utils/fileHelpers";
import { useZipDownload } from "./hooks/useZipDownload"; // Handles all zip downloads now
// import { useFolderDownload } from "./hooks/useFolderDownload"; // <-- REMOVE Import
import { ICE_SERVERS } from "./utils/signaling"; // Import ICE_SERVERS

function App() {
  function getInitialStepAndDriveCode() {
    const pathDriveCode = window.location.pathname.slice(1).toUpperCase();
    const asReceiver =
      new URLSearchParams(window.location.search).get("as") === "receiver";
    if (
      pathDriveCode.length === 6 &&
      /^[A-Z0-9]+$/.test(pathDriveCode) &&
      asReceiver
    ) {
      return { step: "receiver", driveCode: pathDriveCode };
    }
    return { step: "init", driveCode: "" };
  }

  const initial = getInitialStepAndDriveCode();
  const [step, setStep] = useState(initial.step);
  const [files, setFiles] = useState([]); // Array: {name, size, type, file, fileId, path?} path includes full path from dropzone
  const [driveCode, setDriveCode] = useState(initial.driveCode);
  const [joinDriveCodeInput, setJoinDriveCodeInput] = useState(""); // State for join input
  const [isJoiningDrive, setIsJoiningDrive] = useState(false); // New state for loading
  const [qrValue, setQrValue] = useState("");
  const [receiverFilesMeta, setReceiverFilesMeta] = useState([]); // Array for receiver: {name, size, type, fileId, path?}
  const [error, setError] = useState("");
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());
  const [showToast, setShowToast] = useState(false); // State for toast visibility
  const toastTimeoutRef = useRef(null); // Ref for toast timeout

  const fileBlobs = useRef({});
  const peerConns = useRef({});
  const dataChannels = useRef({});
  const filesRef = useRef(files);
  const socket = useSocket();
  const { postMessage } = useServiceWorker();
  const pendingSignals = useRef({});
  window.pendingSignals = pendingSignals.current;
  const activeZipPcHeartbeats = useRef({}); // Tracks heartbeats for sender's main PCs for zip ops
  const prevDriveCodeRef = useRef(null); // To track driveCode changes for receiver cleanup

  // Cleanup toast timeout on unmount
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

  // --- Define handleSignal using useCallback for stable reference ---
  const handleSignal = React.useCallback(
    // Function definition starts here
    ({ fileId, data, room }) => {
      const pc = peerConns.current[fileId];
      // console.log(`[App] handleSignal called for ${fileId}. PC exists? ${!!pc}`);
      if (!pc) {
        // console.log(`[App] Signal received for unknown peer ${fileId}, buffering.`);
        if (!pendingSignals.current[fileId]) {
          pendingSignals.current[fileId] = [];
        }
        pendingSignals.current[fileId].push({ data, room });
        return; // Explicit return when buffering
      }

      // console.log(`[App] Processing signal for ${fileId}`);
      if (data && data.sdp) {
        // Handle SDP Offer/Answer
        const sdp = new RTCSessionDescription(data.sdp);
        if (sdp.type === "offer") {
          // console.log(`[App] Processing OFFER for ${fileId}`);
          pc.setRemoteDescription(sdp)
            .then(() => pc.createAnswer()) // Chain promises
            .then((answer) => pc.setLocalDescription(answer))
            .then(() => {
              // Ensure localDescription is set before emitting
              if (pc.localDescription) {
                 socket.emit("signal", {
                   room: driveCode,
                   fileId,
                   data: { sdp: pc.localDescription },
                 });
              } else {
                 console.error(
                   `[App] Local description not set before emitting answer for ${fileId}`
                 );
              }
            })
            .catch((e) =>
              console.error(`[App] Error handling offer for ${fileId}:`, e)
            );
        } else if (sdp.type === "answer") {
          // console.log(`[App] Processing ANSWER for ${fileId}`);
          pc.setRemoteDescription(sdp).catch((e) =>
            console.error(
              `[App] Error setting remote description (answer) for ${fileId}:`,
              e
            )
          );
        }
      } else if (data && data.candidate) {
        // Handle ICE Candidate
        // console.log(`[App] Processing ICE CANDIDATE for ${fileId}`);
        const candidate = new RTCIceCandidate(data.candidate);
        pc.addIceCandidate(candidate).catch((e) => {
          // Ignore benign errors like candidate already added or connection closed
           if (
             !e.message.includes("OperationError") &&
             !e.message.includes("InvalidStateError")
           ) {
             console.error(`[App] Error adding ICE candidate for ${fileId}:`, e);
           }
        });
      }
    },
    // Dependency array for useCallback
    [socket, peerConns, dataChannels, driveCode]
  ); // Closing parenthesis for useCallback call

  // --- Register socket listener ---
  useEffect(() => {
    socket.on("signal", handleSignal);
    // REMOVED prepare-zip-download-peer listener logic
    return () => {
      socket.off("signal", handleSignal);
    };
  }, [socket, handleSignal]); // Use handleSignal from useCallback

  // --- Minimal WebRTC logic helpers ---
  const cleanupWebRTCInstance = React.useCallback((id) => { // Renamed parameter for clarity
    const pc = peerConns.current[id];

    // If this ID corresponds to a main PeerConnection that had associated DataChannels (e.g., for a zip operation)
    if (pc && pc._associatedTransferIds) {
      console.log(`[App cleanup] Cleaning up main PC ${id} (zip/folder type) and its ${pc._associatedTransferIds.size} associated DataChannels.`);
      pc._associatedTransferIds.forEach(transferId => {
        const associatedDc = dataChannels.current[transferId];
        if (associatedDc) {
          try {
            if (associatedDc.readyState !== "closed") {
              associatedDc.close();
              console.log(`[App cleanup] Closed associated DataChannel ${transferId} for main PC ${id}`);
            }
          } catch (e) {
            console.warn(`[App cleanup] Error closing associated DataChannel ${transferId}:`, e);
          }
          delete dataChannels.current[transferId]; // Remove from global tracking
        }
      });
      delete pc._associatedTransferIds; // Clean up the tracking set itself
      if (activeZipPcHeartbeats.current.hasOwnProperty(id)) {
        delete activeZipPcHeartbeats.current[id]; // Stop tracking heartbeat for this PC
        console.log(`[App cleanup] Stopped and REMOVED heartbeat tracking for zip PC: ${id}`);
      } else {
        console.warn(`[App cleanup] Heartbeat tracking for zip PC ${id} was expected but not found for deletion.`);
      }
    } else {
      // This might be a cleanup for a single file's DataChannel directly (ID is transferId),
      // or a PC that wasn't a main zip PC (e.g. single file PC, ID is transferId).
      // It should not be a main zip PC ID if it doesn't have _associatedTransferIds.
      if (activeZipPcHeartbeats.current.hasOwnProperty(id)) {
        console.warn(`[App cleanup] PC ${id} was in activeZipPcHeartbeats but NOT identified as a main zip PC (no _associatedTransferIds). Removing from heartbeats.`);
        delete activeZipPcHeartbeats.current[id];
      }
      const dc = dataChannels.current[id];
      if (dc) {
        try {
          if (dc.readyState !== "closed") {
            dc.close();
            console.log(`[App cleanup] Closed DataChannel ${id}`);
          }
        } catch (e) {
          console.warn(`[App cleanup] Error closing DataChannel ${id}:`, e);
        }
        delete dataChannels.current[id];
      }
    }

    // Clean up the PeerConnection itself
    if (pc) {
      try {
        if (pc.signalingState !== "closed") {
          pc.close();
          console.log(`[App cleanup] Closed PeerConnection ${id}`);
        }
      } catch (e) {
        console.warn(`[App cleanup] Error closing PeerConnection ${id}:`, e);
      }
      delete peerConns.current[id];
    }

    // Also delete any pending signals for this id
    if (pendingSignals.current && pendingSignals.current[id]) {
      console.log(`[App cleanup] Deleting pending signals for ${id}`);
      delete pendingSignals.current[id];
    }
  }, [peerConns, dataChannels, pendingSignals, activeZipPcHeartbeats]); // Refs are stable, so this callback is stable

  // --- SENDER: Upload files and create drive, or add more files (flat version) ---
  const handleDrop = (acceptedFiles) => {
    console.log(
      `[handleDrop DEBUG] Fired at ${new Date().toLocaleTimeString()} with ${
        acceptedFiles.length
      } files.`
    ); // Add timestamped log
    if (!acceptedFiles.length) return;
    // Capture the path property provided by react-dropzone
    const filesWithIds = acceptedFiles.map((f) => {
      let processedPath = f.path;

      // 1. Use forward slashes
      if (processedPath) {
        processedPath = processedPath.replace(/\\/g, "/");
      }

      // 2. Remove leading './'
      if (processedPath && processedPath.startsWith("./")) {
        processedPath = processedPath.substring(2);
      }

      // 3. Remove leading/trailing slashes (after other cleaning)
      if (processedPath) {
        processedPath = processedPath.replace(/^\/+|\/+$/g, "");
      }

      // Use processed path, fallback to name if path was invalid/empty
      const finalPath = processedPath || f.name;
      // console.log(`[handleDrop] File: ${f.name}, Original Path: ${f.path}, Processed Path: ${finalPath}`); // Debug log

      return {
        name: f.name, // Original filename
        size: f.size,
        type: f.type,
        file: f, // The File object itself
        fileId: makeFileId(),
        path: finalPath,
      };
    });
    // Combine new files with existing ones using the up-to-date ref
    const combinedFiles = [...filesRef.current, ...filesWithIds];
    setFiles(combinedFiles);
    // Note: filesRef.current will be updated by the useEffect hook watching 'files'

    // Generate metadata from the *combined* list, including the path
    const combinedFilesMeta = combinedFiles.map(
      ({ name, size, type, fileId, path }) => ({
        name, // Keep original name for potential display fallback
        size,
        type,
        fileId,
        path, // <--- ADDED: Send the path to receivers
      })
    );

    if (!driveCode) {
      // First time uploading, create room and send full list
      const code = Math.random().toString(16).slice(2, 8).toUpperCase();
      setDriveCode(code);
      // Generate the receiver URL for QR code
      const driveUrl = `${window.location.origin}/${code}`;
      const receiverUrl = `${driveUrl}?as=receiver`;
      setQrValue(receiverUrl); // Set QR value based on receiver URL
      socket.emit("create-room", code);
      setStep("uploaded");
      socket.emit("file-list", { room: code, filesMeta: combinedFilesMeta });
    } else {
      // Already hosting, just update the list for receivers
      socket.emit("file-list", {
        room: driveCode,
        filesMeta: combinedFilesMeta,
      });
    }
  };

  // --- SENDER: Always respond to get-file-list requests ---
  useEffect(() => {
    const handler = ({ room }) => {
      // Include path in metadata sent on request
      const filesMeta = files.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path, // <--- ADDED
      }));
      socket.emit("file-list", { room, filesMeta });
    };
    socket.on("get-file-list", handler);
    return () => socket.off("get-file-list", handler);
  }, [files, socket]);

  // --- SENDER: Send file list to new receivers on joined-room ---
  useEffect(() => {
    if (!(driveCode && files.length > 0)) return;
    const handler = () => {
      // Include path in metadata sent on join
      const filesMeta = files.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path, // <--- ADDED
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    };
    socket.on("connect", handler);
    return () => socket.off("connect", handler);
  }, [driveCode, files, socket]);

  // --- SENDER: Periodically broadcast file list for late receivers ---
  useEffect(() => {
    if (!(driveCode && files.length > 0)) return;
    const interval = setInterval(() => {
      // Include path in periodic metadata broadcast
      const filesMeta = files.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path, // <--- ADDED
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    }, 3000);
    return () => clearInterval(interval);
  }, [driveCode, files, socket]);

  // --- SENDER: On socket reconnect, re-emit file list ---
  useEffect(() => {
    const handler = () => {
      console.log('[App Sender] Socket connect/reconnect event triggered.');

      if (!driveCode) { // If no drive is active, no special handling needed beyond normal connect.
        console.log('[App Sender] Socket connected, but no active driveCode found in state. No existing drive to re-assert.');
        // No aggressive cleanup if no drive was active.
        return;
      }

      // If a driveCode IS active:
      console.log('[App Sender] Socket (re)connected with active driveCode:', driveCode);
      console.log('[App Sender] Re-asserting room and re-emitting file-list for room:', driveCode, 'Files available:', filesRef.current.length);

      // 1. Re-assert room presence.
      socket.emit("create-room", driveCode);

      // 2. Re-emit the current file list.
      const filesMeta = filesRef.current.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path,
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });

      // DO NOT clean up existing peerConns, dataChannels, or pendingSignals here.
      // Let ongoing WebRTC operations attempt to continue or be managed by their own lifecycles (e.g., heartbeats for zip PCs).
      console.log('[App Sender] Socket (re)connect: Skipped aggressive cleanup of WebRTC states to preserve ongoing operations.');
    };

    socket.on("connect", handler);

    // Initial emit if already connected and hosting when component mounts
    if (socket.connected && driveCode && filesRef.current.length > 0) {
        console.log('[App Sender] Component mounted with active socket and drive. Emitting file-list for room:', driveCode);
        // Call handler directly.
        handler();
    }

    return () => {
      socket.off("connect", handler);
    };
  }, [driveCode, socket]); // Removed cleanupWebRTCInstance from dependencies as it's not called here.

  // --- SENDER: Handle heartbeats from receivers for zip operations ---
  useEffect(() => {
    const heartbeatHandler = (data) => {
      if (data && data.pcId && activeZipPcHeartbeats.current.hasOwnProperty(data.pcId)) {
        console.log(`[App Sender] Received heartbeat for active zip PC: ${data.pcId}`);
        activeZipPcHeartbeats.current[data.pcId] = Date.now();
      } else {
        console.warn(`[App Sender] Received heartbeat for unknown or inactive zip PC:`, data);
      }
    };
    socket.on('heartbeat-zip', heartbeatHandler);
    return () => socket.off('heartbeat-zip', heartbeatHandler);
  }, [socket]);

  // --- SENDER: Periodically check for stale zip PeerConnections via heartbeats ---
  useEffect(() => {
    const HEARTBEAT_TIMEOUT_MS = 60000; // 60 seconds
    const CHECK_INTERVAL_MS = 30000; // Check every 30 seconds

    const intervalId = setInterval(() => {
      const now = Date.now();
      console.log('[App Sender] Checking for stale zip PeerConnections...');
      Object.keys(activeZipPcHeartbeats.current).forEach(pcId => {
        if (now - activeZipPcHeartbeats.current[pcId] > HEARTBEAT_TIMEOUT_MS) {
          console.warn(`[App Sender] Zip PC ${pcId} timed out due to no heartbeat. Cleaning up.`);
          cleanupWebRTCInstance(pcId); // This will also remove it from peerConns
          delete activeZipPcHeartbeats.current[pcId]; // Remove from heartbeat tracking
        }
      });
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [cleanupWebRTCInstance]); // cleanupWebRTCInstance is stable due to useCallback if App.js uses it

  // --- SENDER: Listen for download-file and start appropriate WebRTC ---
  useEffect(() => {
    const downloadHandler = async ({
      // Make handler async for potential await later if needed
      fileId: requestedFileId,
      transferFileId, // This is the unique ID for the specific file/channel
      mainPcId, // ID for the main PeerConnection (NEW)
      room,
      name,
      size,
      type,
      isZipRequest,
      isFolderRequest, // <-- New flag
      folderPath, // <-- New path info
    }) => {
      console.log(
        `[App Sender DEBUG] downloadHandler triggered. Room: ${room}, FileID: ${requestedFileId}, TransferID: ${transferFileId}, MainPCID: ${mainPcId}, isZip: ${isZipRequest}, isFolder: ${isFolderRequest}`
      );

      if (!socket.connected) {
        console.error('[App Sender DEBUG] downloadHandler: Socket not connected. Aborting.');
        setError("Sender not connected to signaling server. Please check connection.");
        return;
      }

      // Always use filesRef.current to find the file
      const fileObj = filesRef.current.find(
        (f) => f.fileId === requestedFileId
      );

      if (!fileObj) {
        console.error(
          `[App] Sender: File not found for requestedFileId: ${requestedFileId}. filesRef.current:`,
          filesRef.current
        ); // Keep error
        console.error("File not found for download. Please re-upload or refresh.");
        // setError("File not found for download. Please re-upload or refresh."); // Changed to console.error
        return;
      }
      // console.log(`[App] Sender: Found fileObj`);

      const useTransferFileId = transferFileId || makeFileId();
      if (!transferFileId) {
        console.warn(
          `[App] Sender: Missing transferFileId in request for ${requestedFileId}, generated: ${useTransferFileId}`
        ); // Keep warning
      }

      const fileIndex = filesRef.current.findIndex(
        (f) => f.fileId === fileObj.fileId
      );

      if (fileIndex === -1) {
        console.error(
          `[App] Sender: File index not found for fileId: ${fileObj.fileId}. filesRef.current:`,
          filesRef.current
        ); // Keep error
        console.error("File index not found for download.");
        // setError("File index not found for download."); // Changed to console.error
        return;
      }
      // console.log(`[App] Sender: Found fileIndex`);

      // Determine the PeerConnection ID to use
      // Use mainPcId if provided (for zip or folder requests), otherwise generate one for single file? No, single file uses transferFileId.
      const pcIdToUse = mainPcId; // For zip or folder requests, the receiver dictates the PC ID

      if (isZipRequest || isFolderRequest) {
        // Handle Zip OR Folder requests using the specified mainPcId
        // --- Zip/Folder Request: Use Single PeerConnection (pcIdToUse) ---
        if (!pcIdToUse) {
          console.error(
            `[App Sender] ${
              isZipRequest ? "Zip" : "Folder"
            } request received without mainPcId!`
          );
          console.error(
            `${
              isZipRequest ? "Zip" : "Folder"
            } download error: Missing connection ID.`
          );
          // setError(
          //   `${
          //     isZipRequest ? "Zip" : "Folder"
          //   } download error: Missing connection ID.`
          // ); // Changed to console.error
          return;
        }

        let pc = peerConns.current[pcIdToUse];
        let isNewPc = false;

        // --- Create Main PeerConnection if it doesn't exist ---
        if (!pc) {
          console.log(
            `[App Sender DEBUG] Creating NEW main PeerConnection for ${
              isZipRequest ? "zip" : "folder"
            } request. PC ID: ${pcIdToUse}`
          );
          isNewPc = true;
          // cleanupWebRTCInstance(pcIdToUse); // Cleanup previous instance if any (optional)
          try {
            pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS });
            console.log(`[App Sender DEBUG] Successfully created new RTCPeerConnection for ${pcIdToUse}`, pc);
          } catch (e) {
            console.error(`[App Sender DEBUG] FAILED to create new RTCPeerConnection for ${pcIdToUse}:`, e);
            setError(`Sender: Failed to initialize WebRTC connection: ${e.message}`);
            return; // Critical failure
          }
          pc._associatedTransferIds = new Set(); // Initialize set to track associated data channels
          peerConns.current[pcIdToUse] = pc;
          activeZipPcHeartbeats.current[pcIdToUse] = Date.now(); // Start tracking heartbeat
          console.log(`[App Sender] Started heartbeat tracking for new zip PC: ${pcIdToUse}`);

          // Setup handlers for the NEW main PC
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              console.log(
                `[App Sender] Gathered ICE candidate for main PC ${pcIdToUse}: Type: ${event.candidate.type}, Address: ${event.candidate.address}, Port: ${event.candidate.port}, Protocol: ${event.candidate.protocol}`, event.candidate
              );
              socket.emit("signal", {
                room: driveCode,
                fileId: pcIdToUse,
                data: { candidate: event.candidate },
              });
            } else {
              console.log(
                `[App Sender] End of ICE candidates for ${pcIdToUse}.`
              );
            }
          };
          pc.onicecandidateerror = (event) => {
            if (event.errorCode) {
              if (event.errorCode === 701) {
                // console.warn(`[App Sender] Main PC ICE candidate error 701 (usually ignorable) for ${pcIdToUse}:`, event.errorText);
              } else {
                console.error(
                  `[App Sender] Main PC ICE candidate error for ${pcIdToUse}:`
                );
                console.error(
                  `  Error Code: ${event.errorCode}, Host Candidate: ${event.hostCandidate}, Server URL: ${event.url}, Text: ${event.errorText}`
                );
              }
            }
            // Don't setError here for the whole zip based on candidate error
          };
          pc.onconnectionstatechange = () => {
            console.log(
              `[App Sender] Main PC connection state change for ${pcIdToUse}: ${pc.connectionState}`
            );
            switch (pc.connectionState) {
              case "disconnected":
                console.warn(
                  `[App Sender] Main PC ${pcIdToUse} disconnected. State: ${pc.connectionState}. Waiting for potential auto-reconnect.`
                );
                // Do NOT cleanup yet, give it a chance to recover.
                // Heartbeat mechanism will eventually clean up if it stays disconnected for too long.
                break;
              case "failed":
              case "closed":
                console.error(
                  `[App Sender] Main PC ${pcIdToUse} ${pc.connectionState}. State: ${pc.connectionState}. Cleaning up.`
                );
                cleanupWebRTCInstance(pcIdToUse);
                break;
              default:
                // For 'new', 'connecting', 'connected' - no action needed here.
                break;
            }
          };
          pc.onsignalingstatechange = () => {
            console.log(
              `[App Sender] Main PC signaling state change for ${pcIdToUse}: ${pc.signalingState}`
            );
          };

          // Process pending signals for the NEW main PC
          if (pendingSignals && pendingSignals.current[pcIdToUse]) {
            console.log(
              `[App Sender] Processing ${pendingSignals.current[pcIdToUse].length} pending signals for NEW main PC ${pcIdToUse}`
            );
            pendingSignals.current[pcIdToUse].forEach((signalData) => {
              handleSignal({ fileId: pcIdToUse, ...signalData }); // Use pcIdToUse
            });
            delete pendingSignals.current[pcIdToUse];
          }
        } else {
          console.log(
            `[App Sender] Reusing existing main PeerConnection for ${
              isZipRequest ? "zip" : "folder"
            } request: ${pcIdToUse}`
          );
        }

        // --- Create Data Channel for the specific file ---
        // Use transferFileId as the channel label for multiplexing on the shared PC
        console.log(
          `[App Sender] Creating DataChannel for transferId: ${useTransferFileId} on main PC: ${pcIdToUse}`
        );
        const dc = pc.createDataChannel(useTransferFileId); // Label channel with unique transfer ID
        dc.binaryType = "arraybuffer";
        dataChannels.current[useTransferFileId] = dc; // Store channel by transfer ID
        if (peerConns.current[pcIdToUse] && peerConns.current[pcIdToUse]._associatedTransferIds) {
          peerConns.current[pcIdToUse]._associatedTransferIds.add(useTransferFileId);
        }

        // --- Setup Data Channel Handlers (File Sending Logic) ---
        dc.onopen = () => {
          console.log(
            `[App Sender] DataChannel opened for transferId: ${useTransferFileId}`
          );
          // Send META first
          console.log(
            `[App Sender] Sending META for ${useTransferFileId}: ${fileObj.name}:${fileObj.size}`
          );
          dc.send(`META:${fileObj.name}:${fileObj.size}`);

          // File sending logic (adapted from startZipSenderConnection)
          const chunkSize = 256 * 1024; // Chunk size is 256KB
          let offset = 0;
          const MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024; // Try 4MB buffer
          dc.bufferedAmountLowThreshold = 2 * 1024 * 1024; // Set threshold to 2MB

          function sendChunk() {
            if (offset < fileObj.size) {
              if (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                dc.onbufferedamountlow = () => {
                  dc.onbufferedamountlow = null;
                  Promise.resolve().then(sendChunk); // Use microtask for faster re-queue
                };
                return;
              }
              const nextChunkSize = Math.min(chunkSize, fileObj.size - offset);
              const slice = fileObj.file.slice(offset, offset + nextChunkSize);
              const reader = new FileReader();
              reader.onload = (e) => {
                try {
                  if (dc.readyState === "open") {
                    dc.send(e.target.result);
                    offset += nextChunkSize;
                    Promise.resolve().then(sendChunk); // Use microtask for faster re-queue
                  } else {
                    console.error(
                      `[App Sender] Data channel not open for ${useTransferFileId}:`,
                      dc.readyState
                    );
                    // setError && // Changed to console.error
                    //   setError(
                    //     `Sender: DataChannel closed unexpectedly for ${fileObj.name}`
                    //   );
                    console.error(`Sender: DataChannel closed unexpectedly for ${fileObj.name}`);
                    // Don't cleanup main PC here, just this channel? Or let connection state handle it.
                    delete dataChannels.current[useTransferFileId];
                  }
                } catch (err) {
                  // setError && // Changed to console.error
                  //   setError(
                  //     `Sender: DataChannel send failed for ${fileObj.name}: ${err.message}`
                  //   );
                  console.error(
                    `[App Sender] DataChannel send error for ${useTransferFileId}: ${err.message}`,
                    err
                  );
                  delete dataChannels.current[useTransferFileId];
                }
              };
                reader.onerror = (e) => {
                console.error(
                  `[App Sender] FileReader error for ${useTransferFileId}:`,
                  e
                );
                // setError && // Changed to console.error
                //   setError(`Sender: FileReader error for ${fileObj.name}`);
                delete dataChannels.current[useTransferFileId];
              };
              reader.readAsArrayBuffer(slice);
            } else {
              console.log(
                `[App Sender] Sending EOF for ${useTransferFileId}: ${fileObj.name}`
              );
              dc.send("EOF:" + fileObj.name);
              // Channel might be closed by receiver after EOF, or keep open for potential reuse?
              // For simplicity, let receiver close or main PC failure handle cleanup.
            }
          }
          sendChunk(); // Start sending
        };

        dc.onerror = (event) => { // event is RTCErrorEvent
          const errorDetail = event.error ? `${event.error.name}: ${event.error.message}` : 'Unknown DataChannel error';
          console.error(
            `[App Sender] DataChannel error for transferId: ${useTransferFileId}. Error: ${errorDetail}`,
            event
          );
          delete dataChannels.current[useTransferFileId]; // Clean up failed channel ref
        };

        dc.onclose = () => {
          console.log(
            `[App Sender] DataChannel closed for transferId: ${useTransferFileId}`
          );
          delete dataChannels.current[useTransferFileId]; // Clean up closed channel ref
        };

        // --- Create and Send Offer ONLY if it's a new PeerConnection ---
        // Create and Send Offer ONLY if it's a new PeerConnection (for either zip or folder)
        if (isNewPc) {
          console.log(
            `[App Sender] Creating and sending OFFER for main PC ${pcIdToUse}`
          );
          pc.createOffer()
            .then((offer) => {
              console.log(`[App Sender DEBUG] Offer created for ${pcIdToUse}:`, offer);
              return pc.setLocalDescription(offer);
            })
            .then(() => {
              if (pc.localDescription) {
                console.log(`[App Sender DEBUG] Local description set for ${pcIdToUse}. Emitting signal.`);
                socket.emit("signal", {
                  room: driveCode,
                  fileId: pcIdToUse,
                  data: { sdp: pc.localDescription },
                });
              } else {
                console.error(
                  `[App Sender DEBUG] Local description NOT SET after setLocalDescription for ${pcIdToUse}. Cannot emit offer.`
                );
                setError("Sender: Failed to set local description for WebRTC.");
                cleanupWebRTCInstance(pcIdToUse);
              }
            })
            .catch((e) => {
              console.error(
                `[App Sender DEBUG] Error during offer creation/setLocalDescription for ${pcIdToUse}:`,
                e
              );
              setError(`Sender: Failed to create WebRTC offer: ${e.message}`);
              cleanupWebRTCInstance(pcIdToUse); // Clean up failed PC
            });
        }
        // If PC already exists, the receiver's offer/answer flow handles channel opening
      } else {
        // --- Single File Request (Original Logic - NOT zip or folder) ---
        // --- Start Single File Sender (Original Logic) ---
        // console.log("[App] Sender: Calling startWebRTC");
        startWebRTC({
          isSender: true,
          code: driveCode,
          fileIndex,
          filesRef,
          peerConns,
          dataChannels,
          setError,
          driveCode,
          socket,
          sendSWMetaAndChunk, // Needed for single file
          cleanupWebRTCInstance,
          makeFileId,
          fileId: useTransferFileId,
          // No zip callbacks needed here
        });
        // console.log(`[App] Sender: Called startWebRTC`);
      }
    };
    socket.on("download-file", downloadHandler);
    return () => socket.off("download-file", downloadHandler);
  }, [socket, driveCode]);

  // --- RECEIVER: Robustly join and request file list after socket connects ---
  useEffect(() => {
    if (step === "receiver" && driveCode) {
      // Check if it's a new drive or a transition to receiver mode for the current driveCode
      if (driveCode !== prevDriveCodeRef.current || prevStepRef.current !== "receiver") {
        console.log(`[App Receiver] Initializing for drive ${driveCode}. Performing cleanup of existing WebRTC instances.`);
        // Iterate and cleanup existing peer connections. cleanupWebRTCInstance handles removing from refs.
        Object.keys(peerConns.current).forEach(id => {
          console.log(`[App Receiver] Proactively cleaning up peerConn: ${id}`);
          cleanupWebRTCInstance(id);
        });
        // Iterate and cleanup existing data channels that might not be associated with a PC cleared above.
        // cleanupWebRTCInstance also handles data channels if called with their ID.
        Object.keys(dataChannels.current).forEach(id => {
           console.log(`[App Receiver] Proactively cleaning up dataChannel: ${id}`);
           cleanupWebRTCInstance(id); // It's safe to call this; if it's a DC ID, it will be handled.
        });
        pendingSignals.current = {}; // Clear all pending signals
        console.log('[App Receiver] Proactive WebRTC state cleanup complete for new drive/receiver entry.');
      }
      prevDriveCodeRef.current = driveCode; // Update prevDriveCodeRef after the check

      const joinAndRequest = () => {
        console.log(`[App Receiver] Joining room: ${driveCode} and requesting file list.`);
        socket.emit("join-room", driveCode);
        socket.emit("get-file-list", { room: driveCode });
      };

      if (socket.connected) {
        joinAndRequest();
      }
      socket.on("connect", joinAndRequest);

      return () => {
        console.log(`[App Receiver] Cleaning up effect for driveCode: ${driveCode}.`);
        socket.off("connect", joinAndRequest);
      };
    } else {
      // Not in receiver mode or no drive code, clear prevDriveCodeRef
      prevDriveCodeRef.current = null;
    }
  }, [step, driveCode, socket, cleanupWebRTCInstance]);

  // Ref to store the previous step to detect transition into receiver mode
  const prevStepRef = useRef();
  useEffect(() => {
    prevStepRef.current = step;
  }, [step]);

  // --- RECEIVER: Listen for file list ---
  useEffect(() => {
    const handler = ({ filesMeta }) => {
      const validatedMeta = Array.isArray(filesMeta) ? filesMeta : []; // Ensure it's an array
      setReceiverFilesMeta(validatedMeta);
    };
    socket.on("file-list", handler);
    return () => socket.off("file-list", handler);
  }, [socket]);

  // --- RECEIVER: Download request ---
  const handleDownloadRequest = (fileId) => {
    setError(""); // Clear previous errors
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
      if (downloadingFiles.has(fileId)) {
        console.warn(`[App Receiver] Single download stuck for ${fileId}`);
      }
    }, 10000);
    const swHandler = async (event) => {
      // This handler is only for single file downloads now
      if (
        event.data.type === "sw-ready" &&
        event.data.fileId === transferFileId
      ) {
        // Post metadata to SW using the transferFileId, INCLUDING fileSize
        postMessage({
          fileId: transferFileId,
          filename: fileMeta.name,
          mimetype: fileMeta.type,
          fileSize: fileMeta.size // Add fileSize here
        });
        // console.log("[App Receiver] Emitting download-file");
        // Emit download request with original fileId and the transferFileId
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
        // console.log("[App] Receiver: startWebRTC", { // Keep for debugging download start
        //   isSender: false,
        //   requestedFileId: fileMeta.fileId,
        //   transferFileId,
        //   fileIndex,
        //   fileName: fileMeta.name,
        // });
        // Ensure cleanup uses the correct transfer ID before starting
        cleanupWebRTCInstance(transferFileId);
        startWebRTC({
          isSender: false,
          code: driveCode,
          fileIndex, // Note: fileIndex is based on receiverFilesMeta using original fileId
          filesRef: { current: receiverFilesMeta }, // filesRef still uses original fileId
          peerConns,
          dataChannels,
          setError,
          driveCode,
          socket,
          sendSWMetaAndChunk,
          cleanupWebRTCInstance,
          makeFileId,
          fileId: transferFileId, // Pass the consistent transferFileId for WebRTC
        });
        navigator.serviceWorker.removeEventListener("message", swHandler);
      }
    };
    navigator.serviceWorker.addEventListener("message", swHandler);
  };

  useEffect(() => {
    const handler = (event) => {
      if (event.data && event.data.done && event.data.fileId) {
        const debug =
          window.__downloadDebug && window.__downloadDebug[event.data.fileId];
        if (debug) {
          // console.info(`[App Receiver] Single download complete via SW`);
        }
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

  // --- Listen for download-ready from SW ---
  useEffect(() => {
    const handler = (event) => {
      if (event.data.type === "download-ready") {
        const { fileId, url } = event.data;
        // console.log("[App Receiver] Download ready via SW");
        // Open the download in a new tab
        window.open(url, "_blank");
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, []);


  // Integrate the unified useZipDownload hook
  const {
    startZipProcess, // <-- Renamed function
    isZipping,
    zipProgress,
    downloadSpeed, // Add speed
    etr, // Add etr
    error: zipError, // Alias to avoid state name conflict
    zippingFolderPath, // Get the path of the folder being zipped
    connectionStatus: zipConnectionStatus, // Get connection status for zip downloads
  } = useZipDownload({
    receiverFilesMeta,
    driveCode,
    socket,
    cleanupWebRTCInstance,
    makeFileId,
    sendSWMetaAndChunk, // Pass the SW function for single file fallback
    handleDownloadRequest,
    peerConns,
    dataChannels,
    pendingSignals, // Pass down the pendingSignals ref
    handleSignal, // Pass down the memoized handleSignal function
  });

  // --- REMOVE useFolderDownload hook integration ---

  // --- CONSOLIDATED: Warn before leaving/reloading ---
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      let confirmationMessage = "";
      let needsConfirmation = false;

      if (step === 'uploaded' && files.length > 0) {
        confirmationMessage = 'Leaving or reloading will stop the file transfer. Keep this page open to continue sharing.';
        needsConfirmation = true;
      } else if (step === 'receiver' && isZipping) {
        confirmationMessage = 'Files are currently being downloaded and zipped. Leaving or reloading now may interrupt the process. Are you sure you want to leave?';
        needsConfirmation = true;
      }

      if (needsConfirmation) {
        event.preventDefault();
        event.returnValue = confirmationMessage; // For older browsers
        return confirmationMessage; // For modern browsers
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [step, files, isZipping]); // Dependencies for the consolidated handler


  // This function is ONLY for single file downloads now
  function sendSWMetaAndChunk(fileId, chunk, filename, mimeType, fileSize) {
   if (!navigator.serviceWorker.controller) {
     console.error("[App] SW Ctrl not available for sendSWMetaAndChunk"); // Keep error
     return;
   }

   if (filename && (!chunk || chunk === null)) {
     // This is a metadata-only message
     const sizeToSend = (typeof fileSize === 'number' && fileSize > 0) ? fileSize : undefined;
     // console.log(`[App sendSWMetaAndChunk] Meta for SW. fileId: ${fileId}, filename: ${filename}, received fileSize: ${fileSize}, sizeToSend: ${sizeToSend}`); // Diagnostic log removed
     navigator.serviceWorker.controller.postMessage({
       type: "meta", // Service worker might still use this type to identify meta messages
       fileId, // This is transferFileId
       filename: filename,
       mimetype: mimeType || "application/octet-stream",
       fileSize: sizeToSend, // Send fileSize at the top level, ensure it's a positive number or undefined
      });
      return;
    }

    if (chunk) {
      // Send a chunk of data
      navigator.serviceWorker.controller.postMessage(
        {
          type: "chunk",
          fileId,
          chunk,
          done: false,
        },
        [chunk instanceof ArrayBuffer ? chunk : undefined]
      );
    }
  }

  // Add this to your service worker registration code
  // Typically in index.js or App.js
  // Look for where you register the service worker and add there

  // Add this event listener to your service worker registration

  function isDownloading(fileId) {
    return downloadingFiles.has(fileId);
  }

  const handleDeleteFile = (fileId) => {
    const newFiles = files.filter((f) => f.fileId !== fileId);
    setFiles(newFiles);
    filesRef.current = newFiles;
    if (driveCode) {
      // Include path when sending updated list after delete
      const filesMeta = newFiles.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path, // <--- ADDED
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    }
  };

  // --- SENDER: Delete Folder ---
  const handleDeleteFolder = (folderPath) => {
    // Filter out files that start with the folder path + '/'
    // Also filter out files whose path *is* the folder path (shouldn't happen, but safety)
    const pathPrefix = folderPath + "/";

    const newFiles = filesRef.current.filter((f) => {
      const isDirectMatch = f.path === folderPath; // Should not happen for folders from buildFileTree, but check anyway
      const isPrefixMatch = f.path && f.path.startsWith(pathPrefix);
      const shouldKeep = !(isDirectMatch || isPrefixMatch);
      return shouldKeep;
    });

    if (newFiles.length === filesRef.current.length) {
      return; // No changes made
    }

    setFiles(newFiles); // Update state
    // filesRef will be updated by useEffect

    // Emit updated file list to receivers
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

  // --- RECEIVER: Download Folder ---
  const handleDownloadFolder = (folderPath) => {
    setError(""); // Clear previous errors
    // Call the unified zip process function with the folder path filter
    startZipProcess(folderPath); // Pass folderPath as the filter
  };

  const handleJoinDrive = (codeToJoin) => {
    setError(""); // Clear previous errors
    setIsJoiningDrive(true); // Start loading
    const upperCode = codeToJoin.toUpperCase();
    // Basic validation
    if (upperCode && upperCode.length === 6 && /^[A-Z0-9]+$/.test(upperCode)) {
      // Navigate to the receiver URL for this code
      // This leverages the existing URL parsing logic on page load
      // Simulate a delay for loading state visibility if navigation is too fast
      setTimeout(() => {
        window.location.href = `/${upperCode}?as=receiver`;
        // setIsJoiningDrive(false); // Will be false on new page load anyway
      }, 500); // Small delay
    } else {
      setError("Invalid drive code. Must be 6 alphanumeric characters.");
      setJoinDriveCodeInput(""); // Clear invalid input
      setIsJoiningDrive(false); // Stop loading on error
    }
  };

  // --- Copy Link Handler ---
  const handleCopy = (textToCopy) => {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        // Clear existing timeout if any
        if (toastTimeoutRef.current) {
          clearTimeout(toastTimeoutRef.current);
        }
        // Show toast
        setShowToast(true);
        // Set timeout to hide toast after 2 seconds
        toastTimeoutRef.current = setTimeout(() => {
          setShowToast(false);
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
        // Optionally show an error toast/message
      });
  };

  // --- Helper Functions for UI ---
  function formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) {
      return `${bytesPerSecond.toFixed(0)} B/s`;
    } else if (bytesPerSecond < 1024 * 1024) {
      return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    } else {
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
    }
  }

  function formatEtr(seconds) {
    if (seconds === null || seconds === Infinity || seconds < 0 || isNaN(seconds)) {
      return "--:--";
    }
  
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
  
    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
    } else {
      return `${secs}s`;
    }
  }
  // -----------------------------

  // --- UI ---

  // Header component
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
          className="home-link header-icon-link" // Added common class for styling
          onClick={() => (window.location.href = "/")}
          title="Home"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            height="48px" 
            viewBox="0 0 24 24" 
            width="48px" 
            fill="#000000" // Standard black fill for Material Icons
            className="home-icon header-icon-svg" // Added common class
          >
            <path d="M0 0h24v24H0V0z" fill="none"/>
            <path d="M10 19v-5h4v5c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-7h1.7c.46 0 .68-.57.33-.87L12.67 3.6c-.38-.34-.96-.34-1.34 0l-8.36 7.53c-.34.3-.13.87.33.87H5v7c0 .55.45 1 1 1h3c.55 0 1-.45 1-1z"/>
          </svg>
        </div>
        <a
          href="https://github.com/Shanmus4/infinityshare"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link header-icon-link" // Added common class
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="48px"
            viewBox="0 0 24 24"
            width="48px"
            fill="#000000"
            className="github-icon header-icon-svg" // Added common class
          >
            {/* GitHub path data is more complex, assuming it's correct and just ensuring size/class consistency */}
            <path d="M12 1.27a11 11 0 00-3.48 21.46c.55.1.73-.24.73-.53v-1.84c-3.03.65-3.67-1.46-3.67-1.46a2.89 2.89 0 00-1.21-1.58c-.99-.68.08-.66.08-.66a2.29 2.29 0 011.66 1.12 2.33 2.33 0 003.19.91 2.32 2.32 0 01.68-1.45c-2.43-.28-4.98-1.22-4.98-5.42a4.25 4.25 0 011.11-2.91 3.93 3.93 0 01.11-2.88s.92-.3 3 1.12a10.3 10.3 0 015.44 0c2.08-1.42 3-1.12 3-1.12a3.93 3.93 0 01.11 2.88 4.25 4.25 0 011.11 2.91c0 4.21-2.55 5.14-4.99 5.42a2.58 2.58 0 01.73 2v2.92c0 .29.18.63.73.53A11 11 0 0012 1.27z"/>
          </svg>
        </a>
      </div>
    </div>
  );

  if (step === "init") {
    return (
      <>
        {" "}
        {/* Use Fragment to wrap header and main content */}
        <AppHeader />
        <div className="main-section">
          <div className="content-div">
            {/* Send Section */}
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
              <DropzoneArea
                onDrop={handleDrop}
                // The text prop will be overridden by custom content if we put children inside DropzoneArea
                // For now, we'll rely on the new CSS for styling and add custom children for the icon and text
              >
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
              {/* <div className="upload-warning">
                 Files will only be available while this tab is open. Do NOT reload or close this tab.
               </div> */}{" "}
              {/* Warning text removed from init step */}
            </div>

            {/* Receive Section */}
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
                  placeholder="Enter 6 character drive code"
                  value={joinDriveCodeInput}
                  onChange={(e) =>
                    setJoinDriveCodeInput(e.target.value.toUpperCase())
                  }
                  maxLength={6}
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
              {error && ( // Conditionally render error message
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
          </div>
        </div>
      </>
    );
  }
  if (step === "uploaded") {
    const driveUrl = `${window.location.origin}/${driveCode}`; // Keep driveUrl logic
    const receiverUrl = `${driveUrl}?as=receiver`; // Keep receiverUrl logic
    return (
      <>
        {" "}
        {/* Use Fragment */}
        <AppHeader />
        <div className="main-section">
          <div className="content-div">
            {/* Append Files Section (Moved Up) */}
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
              {/* Using send-receive-div for consistent border/padding */}
              <div className="send-receive-div">
                {/* No subhead here */}
                <DropzoneArea onDrop={handleDrop} className="dropzone-append">
                  {" "}
                  {/* Pass className here */}
                  {/* Apply modifier class for height */}
                  <div className="dropzone-internal-content">
                    {" "}
                    {/* Removed dropzone-append from here */}
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

            {/* Sharing Info Section (Moved Down) */}
            <div className="sharing-info-section">
              <div className="link-details">
                {" "}
                {/* New wrapper div */}
                <div className="qr-code-container">
                  <QRCodeBlock receiverUrl={receiverUrl} />{" "}
                  {/* Pass only receiverUrl */}
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
                        {/* Changed fill to black */}
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
              {/* File List Section is now rendered by FileList component */}
              <FileList
                files={files}
                onDelete={handleDeleteFile}
                onDeleteFolder={handleDeleteFolder}
                isSender={true}
                // Pass necessary props for FileList styling/functionality if needed
              />
            </div>

            {/* Removed original warning div */}
          </div>
          {/* Toast Snackbar */}
          <div className={`toast-snackbar ${showToast ? "show" : ""}`}>
            {/* Changed icon to a generic link icon */}
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
        </div>
      </>
    );
  }
  if (step === "receiver") {
    // Determine if "Download All" button should be disabled
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

              {/* General error display (not specific to zipping process) */}
              {(error || zipError) && ( // Show 'error' or 'zipError'
                <div className="error-subcontainer receiver-error-subcontainer" style={{ marginBottom: '16px' }}> {/* Added margin-bottom */}
                  <div className="error-field">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" className="error-icon">
                      <path d="M12 17C12.2833 17 12.521 16.904 12.713 16.712C12.905 16.52 13.0007 16.2827 13 16C12.9993 15.7173 12.9033 15.48 12.712 15.288C12.5207 15.096 12.2833 15 12 15C11.7167 15 11.4793 15.096 11.288 15.288C11.0967 15.48 11.0007 15.7173 11 16C10.9993 16.2827 11.0953 16.5203 11.288 16.713C11.4807 16.9057 11.718 17.0013 12 17ZM11 13H13V7H11V13ZM12 22C10.6167 22 9.31667 21.7373 8.1 21.212C6.88334 20.6867 5.825 19.9743 4.925 19.075C4.025 18.1757 3.31267 17.1173 2.788 15.9C2.26333 14.6827 2.00067 13.3827 2 12C1.99933 10.6173 2.262 9.31733 2.788 8.1C3.314 6.88267 4.02633 5.82433 4.925 4.925C5.82367 4.02567 6.882 3.31333 8.1 2.788C9.318 2.26267 10.618 2 12 2C13.382 2 14.682 2.26267 15.9 2.788C17.118 3.31333 18.1763 4.02567 19.075 4.925C19.9737 5.82433 20.6863 6.88267 21.213 8.1C21.7397 9.31733 22.002 10.6173 22 12C21.998 13.3827 21.7353 14.6827 21.212 15.9C20.6887 17.1173 19.9763 18.1757 19.075 19.075C18.1737 19.9743 17.1153 20.687 15.9 21.213C14.6847 21.739 13.3847 22.0013 12 22ZM12 20C14.2333 20 16.125 19.225 17.675 17.675C19.225 16.125 20 14.2333 20 12C20 9.76667 19.225 7.875 17.675 6.325C16.125 4.775 14.2333 4 12 4C9.76667 4 7.875 4.775 6.325 6.325C4.775 7.875 4 9.76667 4 12C4 14.2333 4.775 16.125 6.325 17.675C7.875 19.225 9.76667 20 12 20Z"
                        fill="#98282A"
                      />
                    </svg>
                    <span className="error-text">{error || zipError}</span>
                  </div>
                </div>
              )}

              {isZipping && (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Info for user during zipping */}
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
                      The files you requested are downloading and getting zipped.
                      Please do not close or refresh the page while this process
                      is active.
                    </span>
                  </div>
                  
                  {/* Global Progress Display for "Download All" or specific folder */}
                  <div className="progress-display-container">
                     <div className="progress-filename-text">
                      {zippingFolderPath
                        ? `Downloading and Zipping: ${zippingFolderPath.split('/').pop()}.zip`
                        : "Downloading and Zipping All Files..."}
                    </div>
                    {/* Informational text about connection status, separate from filename */}
                    {zipConnectionStatus === 'interrupted' && (
                      <div className="progress-info-text connection-status-info">
                        {zipError || "Connection interrupted, waiting for sender..."}
                      </div>
                    )}
                    {zipConnectionStatus !== 'failed' && ( // Hide progress bar if connection totally failed and reset
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
                              {zipConnectionStatus === 'interrupted' ? "--" : formatSpeed(downloadSpeed)}
                            </span>
                          </span>
                          <span>
                            ETA: <span className="stat-value">{zipConnectionStatus === 'interrupted' ? "--" : formatEtr(etr)}</span>
                          </span>
                        </div>
                        <div className="progress-info-text">
                          {/* Display specific message for interruption, otherwise the standard zipping message */}
                          {zipConnectionStatus === 'interrupted'
                            ? "Download will attempt to resume if sender reconnects."
                            : "Please wait, the download will start automatically when zipping is complete."}
                        </div>
                      </>
                    )}
                    {/* This general error display for 'failed' connectionStatus was already here, 
                        but it might be redundant if the main error display below FileList catches it.
                        Let's keep it for now as it's specific to the progress container when zipping fails.
                    */}
                    {zipConnectionStatus === 'failed' && zipError && (
                        <div className="progress-info-text error-text">{zipError}</div> 
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
                setError={setError} // Pass setError to FileList
                // zippingFolderPath={zippingFolderPath} // Removed, global display now
                // zipProgress={zipProgress} // Removed
                // downloadSpeed={downloadSpeed} // Removed
                // etr={etr} // Removed
                // formatSpeed={formatSpeed} // Removed
                // formatEtr={formatEtr} // Removed
              />
            </div>
          </div>
        </div>
      </>
    );
  }

  // --- CONSOLIDATED: Warn before leaving/reloading ---
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      let confirmationMessage = "";
      let needsConfirmation = false;

      if (step === 'uploaded' && files.length > 0) {
        confirmationMessage = 'Leaving or reloading will stop the file transfer. Keep this page open to continue sharing.';
        needsConfirmation = true;
      } else if (step === 'receiver' && isZipping) {
        confirmationMessage = 'Files are currently being downloaded and zipped. Leaving or reloading now may interrupt the process. Are you sure you want to leave?';
        needsConfirmation = true;
      }

      if (needsConfirmation) {
        event.preventDefault();
        event.returnValue = confirmationMessage; // For older browsers
        return confirmationMessage; // For modern browsers
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [step, files, isZipping]); // Dependencies for the consolidated handler


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
      pathDriveCode.length === 6 &&
      /^[A-Z0-9]+$/.test(pathDriveCode) &&
      !asReceiver
    ) {
      setDriveCode(pathDriveCode);
    }
  }, [step]);

  return null;
}

export default App;
