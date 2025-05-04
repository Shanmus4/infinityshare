import React, { useState, useRef, useEffect } from "react";
import FileList from "./components/FileList";
import DropzoneArea from "./components/DropzoneArea";
import QRCodeBlock from "./components/QRCodeBlock";
import DriveLinkBlock from "./components/DriveLinkBlock";
import ErrorBanner from "./components/ErrorBanner";
import { useSocket } from "./hooks/useSocket";
import { useServiceWorker } from "./hooks/useServiceWorker";
import { startWebRTC } from "./hooks/useWebRTC"; // For single file downloads
// import { startZipSenderConnection } from "./utils/startZipSenderConnection"; // REMOVED - Logic integrated into App.js downloadHandler
// setupZipReceiverConnection is used inside useZipDownload now
import { makeFileId } from "./utils/fileHelpers";
import { useZipDownload } from "./hooks/useZipDownload"; // Import the new hook
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
  const [joinDriveCodeInput, setJoinDriveCodeInput] = useState(''); // State for join input
  const [qrValue, setQrValue] = useState("");
  const [receiverFilesMeta, setReceiverFilesMeta] = useState([]); // Array for receiver: {name, size, type, fileId, path?}
  const [error, setError] = useState("");
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());
  const fileBlobs = useRef({});
  const peerConns = useRef({});
  const dataChannels = useRef({});
  const filesRef = useRef(files);
  const socket = useSocket();
  const { postMessage } = useServiceWorker();
  const pendingSignals = useRef({});
  window.pendingSignals = pendingSignals.current;

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
                 console.error(`[App] Local description not set before emitting answer for ${fileId}`);
              }
            })
            .catch((e) => console.error(`[App] Error handling offer for ${fileId}:`, e));
        } else if (sdp.type === "answer") {
          // console.log(`[App] Processing ANSWER for ${fileId}`);
          pc.setRemoteDescription(sdp)
            .catch((e) => console.error(`[App] Error setting remote description (answer) for ${fileId}:`, e));
        }
      } else if (data && data.candidate) {
        // Handle ICE Candidate
        // console.log(`[App] Processing ICE CANDIDATE for ${fileId}`);
        const candidate = new RTCIceCandidate(data.candidate);
        pc.addIceCandidate(candidate)
          .catch((e) => {
            // Ignore benign errors like candidate already added or connection closed
             if (!e.message.includes("OperationError") && !e.message.includes("InvalidStateError")) {
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

  // --- SENDER: Upload files and create drive, or add more files (flat version) ---
  const handleDrop = (acceptedFiles) => {
    if (!acceptedFiles.length) return;
    // Capture the path property provided by react-dropzone
    console.log("[handleDrop] Raw accepted files:", acceptedFiles.map(f => ({ name: f.name, path: f.path, size: f.size, type: f.type }))); // Log raw paths
    const filesWithIds = acceptedFiles.map((f) => {
      // Basic path cleaning: remove leading './' or '.\' if present
      let cleanedPath = f.path;
      if (cleanedPath && (cleanedPath.startsWith('./') || cleanedPath.startsWith('.\\'))) {
        cleanedPath = cleanedPath.substring(2);
      }
      // Add more cleaning if needed based on logs

      return {
        name: f.name, // Original filename
        size: f.size,
        type: f.type,
        file: f, // The File object itself
        fileId: makeFileId(),
        path: cleanedPath || f.name // Use cleaned path, fallback to name if path was empty/undefined
      };
    });
    console.log("[handleDrop] Processed files with IDs and cleaned paths:", filesWithIds); // Log processed paths
    // Combine new files with existing ones using the up-to-date ref
    const combinedFiles = [...filesRef.current, ...filesWithIds];
    setFiles(combinedFiles);
    // Note: filesRef.current will be updated by the useEffect hook watching 'files'

    // Generate metadata from the *combined* list, including the path
    const combinedFilesMeta = combinedFiles.map(({ name, size, type, fileId, path }) => ({
      name, // Keep original name for potential display fallback
      size,
      type,
      fileId,
      path // <--- ADDED: Send the path to receivers
    }));

    if (!driveCode) {
      // First time uploading, create room and send full list
      const code = Math.random().toString(16).slice(2, 8).toUpperCase();
      setDriveCode(code);
      setQrValue(window.location.origin + "/#" + code);
      socket.emit("create-room", code);
      setStep("uploaded");
      socket.emit("file-list", { room: code, filesMeta: combinedFilesMeta });
    } else {
      // Already hosting, just update the list for receivers
      socket.emit("file-list", { room: driveCode, filesMeta: combinedFilesMeta });
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
        path // <--- ADDED
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
        path // <--- ADDED
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
        path // <--- ADDED
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    }, 3000);
    return () => clearInterval(interval);
  }, [driveCode, files, socket]);

  // --- SENDER: On socket reconnect, re-emit file list ---
  useEffect(() => {
    if (!(driveCode && files.length > 0)) return;
    const handler = () => {
      // Include path in metadata sent on reconnect
      const filesMeta = files.map(({ name, size, type, fileId, path }) => ({
        name,
        size,
        type,
        fileId,
        path // <--- ADDED
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    };
    socket.on("connect", handler);
    return () => socket.off("connect", handler);
  }, [driveCode, files, socket]);

  // --- SENDER: Listen for download-file and start appropriate WebRTC ---
  useEffect(() => {
    const downloadHandler = async ({ // Make handler async for potential await later if needed
      fileId: requestedFileId,
      transferFileId, // This is the unique ID for the specific file/channel
      mainPcId,       // ID for the main PeerConnection (NEW)
      room,
      name,
      size,
      type,
      isZipRequest
   }) => {
     console.log(`[App Sender] Received download-file request. isZip=${isZipRequest}, mainPcId=${mainPcId}, transferFileId=${transferFileId}, requestedFileId=${requestedFileId}`);

    // Always use filesRef.current to find the file
      const fileObj = filesRef.current.find(
        (f) => f.fileId === requestedFileId
      );

      if (!fileObj) {
        console.error(`[App] Sender: File not found for requestedFileId: ${requestedFileId}. filesRef.current:`, filesRef.current); // Keep error
        setError("File not found for download. Please re-upload or refresh.");
        return;
      }
      // console.log(`[App] Sender: Found fileObj`);

      const useTransferFileId = transferFileId || makeFileId();
      if (!transferFileId) {
          console.warn(`[App] Sender: Missing transferFileId in request for ${requestedFileId}, generated: ${useTransferFileId}`); // Keep warning
      }

      const fileIndex = filesRef.current.findIndex(
        (f) => f.fileId === fileObj.fileId
      );

      if (fileIndex === -1) {
        console.error(`[App] Sender: File index not found for fileId: ${fileObj.fileId}. filesRef.current:`, filesRef.current); // Keep error
        setError("File index not found for download.");
        return;
      }
      // console.log(`[App] Sender: Found fileIndex`);

      if (isZipRequest) {
        // --- Zip Request: Use Single PeerConnection (mainPcId) ---
        if (!mainPcId) {
            console.error("[App Sender] Zip request received without mainPcId!");
            setError("Zip download error: Missing connection ID.");
            return;
        }

        let pc = peerConns.current[mainPcId];
        let isNewPc = false;

        // --- Create Main PeerConnection if it doesn't exist ---
        if (!pc) {
            console.log(`[App Sender] Creating NEW main PeerConnection for zip: ${mainPcId}`);
            isNewPc = true;
            // cleanupWebRTCInstance(mainPcId); // Cleanup previous instance if any (optional)
            pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS }); // Use imported ICE_SERVERS
            peerConns.current[mainPcId] = pc;

            // Setup handlers for the NEW main PC
            pc.onicecandidate = (event) => {
              if (event.candidate) {
                console.log(`[App Sender] Emitting ICE candidate for main zip PC ${mainPcId}`);
                socket.emit('signal', { room: driveCode, fileId: mainPcId, data: { candidate: event.candidate } });
              } else {
                 console.log(`[App Sender] End of ICE candidates for ${mainPcId}.`);
              }
            };
            pc.onicecandidateerror = (event) => {
               console.error(`[App Sender] Main zip PC ICE candidate error for ${mainPcId}:`, event);
               if (event.errorCode) {
                   console.error(`  Error Code: ${event.errorCode}, Host Candidate: ${event.hostCandidate}, Server URL: ${event.url}, Text: ${event.errorText}`);
               }
               // Don't setError here for the whole zip based on candidate error
            };
            pc.onconnectionstatechange = () => {
               console.log(`[App Sender] Main zip PC connection state change for ${mainPcId}: ${pc.connectionState}`);
               if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
                  console.error(`[App Sender] Main zip PC ${mainPcId} failed/disconnected/closed.`);
                  setError('Zip download connection failed.');
                  // Consider cleanup of associated channels if needed
                  cleanupWebRTCInstance(mainPcId);
               }
            };
            pc.onsignalingstatechange = () => {
               console.log(`[App Sender] Main zip PC signaling state change for ${mainPcId}: ${pc.signalingState}`);
            };

             // Process pending signals for the NEW main PC
             if (pendingSignals && pendingSignals.current[mainPcId]) {
                console.log(`[App Sender] Processing ${pendingSignals.current[mainPcId].length} pending signals for NEW main PC ${mainPcId}`);
                pendingSignals.current[mainPcId].forEach(signalData => {
                  handleSignal({ fileId: mainPcId, ...signalData });
                });
                delete pendingSignals.current[mainPcId];
             }

        } else {
             console.log(`[App Sender] Reusing existing main PeerConnection for zip: ${mainPcId}`);
        }

        // --- Create Data Channel for the specific file ---
        // Use transferFileId as the channel label for multiplexing
        console.log(`[App Sender] Creating DataChannel for transferId: ${useTransferFileId} on main PC: ${mainPcId}`);
        const dc = pc.createDataChannel(useTransferFileId); // Label channel with unique transfer ID
        dc.binaryType = 'arraybuffer';
        dataChannels.current[useTransferFileId] = dc; // Store channel by transfer ID

        // --- Setup Data Channel Handlers (File Sending Logic) ---
        dc.onopen = () => {
            console.log(`[App Sender] DataChannel opened for transferId: ${useTransferFileId}`);
            // Send META first
            console.log(`[App Sender] Sending META for ${useTransferFileId}: ${fileObj.name}:${fileObj.size}`);
            dc.send(`META:${fileObj.name}:${fileObj.size}`);

            // File sending logic (adapted from startZipSenderConnection)
            const chunkSize = 8 * 1024;
            let offset = 0;
            const MAX_BUFFERED_AMOUNT = 512 * 1024;
            dc.bufferedAmountLowThreshold = 256 * 1024;

            function sendChunk() {
              if (offset < fileObj.size) {
                if (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                  dc.onbufferedamountlow = () => {
                    dc.onbufferedamountlow = null;
                    setTimeout(sendChunk, 10);
                  };
                  return;
                }
                const nextChunkSize = Math.min(chunkSize, fileObj.size - offset);
                const slice = fileObj.file.slice(offset, offset + nextChunkSize);
                const reader = new FileReader();
                reader.onload = (e) => {
                  try {
                    if (dc.readyState === 'open') {
                      dc.send(e.target.result);
                      offset += nextChunkSize;
                      // requestAnimationFrame(sendChunk); // Switch from rAF
                      setTimeout(sendChunk, 0); // Use setTimeout to yield but continue loop
                    } else {
                      console.error(`[App Sender] Data channel not open for ${useTransferFileId}:`, dc.readyState);
                      setError && setError(`Sender: DataChannel closed unexpectedly for ${fileObj.name}`);
                      // Don't cleanup main PC here, just this channel? Or let connection state handle it.
                      delete dataChannels.current[useTransferFileId];
                    }
                  } catch (err) {
                    setError && setError(`Sender: DataChannel send failed for ${fileObj.name}: ${err.message}`);
                    console.error(`[App Sender] DataChannel send error for ${useTransferFileId}:`, err);
                    delete dataChannels.current[useTransferFileId];
                  }
                };
                 reader.onerror = (e) => {
                     console.error(`[App Sender] FileReader error for ${useTransferFileId}:`, e);
                     setError && setError(`Sender: FileReader error for ${fileObj.name}`);
                     delete dataChannels.current[useTransferFileId];
                 };
                reader.readAsArrayBuffer(slice);
              } else {
                console.log(`[App Sender] Sending EOF for ${useTransferFileId}: ${fileObj.name}`);
                dc.send('EOF:' + fileObj.name);
                // Channel might be closed by receiver after EOF, or keep open for potential reuse?
                // For simplicity, let receiver close or main PC failure handle cleanup.
              }
            }
            sendChunk(); // Start sending
        };

        dc.onerror = (err) => {
            setError && setError(`Sender: DataChannel error for ${fileObj.name}.`);
            console.error(`[App Sender] DataChannel error for transferId: ${useTransferFileId}`, err);
            delete dataChannels.current[useTransferFileId]; // Clean up failed channel ref
        };

        dc.onclose = () => {
            console.log(`[App Sender] DataChannel closed for transferId: ${useTransferFileId}`);
            delete dataChannels.current[useTransferFileId]; // Clean up closed channel ref
        };

        // --- Create and Send Offer ONLY if it's a new PeerConnection ---
        if (isNewPc) {
            console.log(`[App Sender] Creating and sending OFFER for main PC ${mainPcId}`);
            pc.createOffer()
              .then(offer => pc.setLocalDescription(offer))
              .then(() => {
                 if (pc.localDescription) {
                    socket.emit('signal', { room: driveCode, fileId: mainPcId, data: { sdp: pc.localDescription } });
                 } else {
                    console.error(`[App Sender] Local description not set before emitting offer for ${mainPcId}`);
                 }
              })
              .catch(e => {
                  console.error(`[App Sender] Error creating offer for ${mainPcId}:`, e);
                  setError && setError(`Sender: Failed to create offer for zip download.`);
                  cleanupWebRTCInstance(mainPcId); // Clean up failed PC
              });
        }

      } else { // --- Single File Request (Original Logic) ---
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
    if (step !== "receiver" || !driveCode) return;
    const joinAndRequest = () => {
      socket.emit("join-room", driveCode);
      socket.emit("get-file-list", { room: driveCode });
    };
    if (socket.connected) {
      joinAndRequest();
    }
    socket.on("connect", joinAndRequest);
    return () => socket.off("connect", joinAndRequest);
  }, [step, driveCode, socket]);

  // --- RECEIVER: Listen for file list ---
  useEffect(() => {
    const handler = ({ filesMeta }) => {
      console.log("[App Receiver] Received file-list event. filesMeta:", filesMeta); // Log received meta
      const validatedMeta = Array.isArray(filesMeta) ? filesMeta : []; // Ensure it's an array
      setReceiverFilesMeta(validatedMeta);
    };
    socket.on("file-list", handler);
    return () => socket.off("file-list", handler);
  }, [socket]);

  // --- RECEIVER: Download request ---
  const handleDownloadRequest = (fileId) => {
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
    const swHandler = async (event) => { // This handler is only for single file downloads now
      if (
        event.data.type === "sw-ready" &&
        event.data.fileId === transferFileId
      ) {
        // Post metadata to SW using the transferFileId
        postMessage({
          fileId: transferFileId,
          filename: fileMeta.name,
          mimetype: fileMeta.type,
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

  // --- Minimal WebRTC logic helpers ---
  function cleanupWebRTCInstance(fileId) {
    const pc = peerConns.current[fileId];
    const dc = dataChannels.current[fileId];
    try {
      if (dc && dc.readyState !== "closed") dc.close();
    } catch (e) {}
    try {
      if (pc && pc.signalingState !== "closed") pc.close();
    } catch (e) {}
    delete peerConns.current[fileId];
    delete dataChannels.current[fileId];
  }

  // Integrate the useZipDownload hook
  const {
    startDownloadAll,
    isZipping,
    zipProgress,
    downloadSpeed, // Add speed
    etr, // Add etr
    error: zipError // Alias to avoid state name conflict
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
    handleSignal // Pass down the memoized handleSignal function
  });

  // --- SENDER: Warn before leaving/reloading ---
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (step === 'uploaded' && files.length > 0) {
        event.preventDefault();
        // Standard way to show browser confirmation dialog with a custom message
        const confirmationMessage = 'Leaving or reloading will stop the file transfer. Keep this page open to continue sharing.';
        event.returnValue = confirmationMessage; // For older browsers
        return confirmationMessage; // For modern browsers
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [step, files]); // Re-run if step or files change

  // Update this function in your app - look for it in App.js or similar file

  // This function is ONLY for single file downloads now
  function sendSWMetaAndChunk(fileId, chunk, filename, mimeType, fileSize) {
   if (!navigator.serviceWorker.controller) {
     console.error("[App] SW Ctrl not available for sendSWMetaAndChunk"); // Keep error
     return;
   }

   if (filename && (!chunk || chunk === null)) {
     // This is a metadata-only message
     // console.log("[App] Sending metadata to SW");
     navigator.serviceWorker.controller.postMessage({
       type: "meta",
       fileId, // This is transferFileId
        meta: {
          name: filename,
          type: mimeType || "application/octet-stream",
          size: fileSize || undefined,
        },
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
        path // <--- ADDED
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    }
  };

  const handleJoinDrive = (codeToJoin) => {
    const upperCode = codeToJoin.toUpperCase();
    // Basic validation
    if (upperCode && upperCode.length === 6 && /^[A-Z0-9]+$/.test(upperCode)) {
      // Navigate to the receiver URL for this code
      // This leverages the existing URL parsing logic on page load
      window.location.href = `/${upperCode}?as=receiver`;
      // No need to set state here, the page reload will handle it
    } else {
      setError('Invalid drive code. Must be 6 alphanumeric characters.');
      setJoinDriveCodeInput(''); // Clear invalid input
    }
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
    if (seconds === null || seconds === Infinity || seconds < 0) {
      return '--:--';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  // -----------------------------

  // --- UI ---
  if (step === "init") {
    return (
      <div className="container">
        <h2>Send Files (noUSB style)</h2>
        <DropzoneArea
          onDrop={handleDrop}
          text="Drag and drop files here, or click to select files"
        />
        <div
          style={{ color: "#e74c3c", marginBottom: "1em", fontWeight: "bold" }}
        >
          Files will only be available while this tab is open. Do NOT reload or
          close this tab.
        </div>
        <h3>Or join a drive to receive files:</h3>
        <input
          type="text"
          placeholder="Enter 6-char drive code"
          value={joinDriveCodeInput}
          onChange={(e) => setJoinDriveCodeInput(e.target.value.toUpperCase())}
          maxLength={6}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleJoinDrive(joinDriveCodeInput);
          }}
          style={{ marginRight: 10, textTransform: 'uppercase' }}
        />
        <button onClick={() => handleJoinDrive(joinDriveCodeInput)}>
          Join Drive
        </button>
      </div>
    );
  }
  if (step === "uploaded") {
    const driveUrl = `${window.location.origin}/${driveCode}`;
    const receiverUrl = `${driveUrl}?as=receiver`;
    return (
      <div className="container">
        <h2>Drive Hosting</h2>
        <QRCodeBlock receiverUrl={receiverUrl} driveCode={driveCode} />
        <DriveLinkBlock receiverUrl={receiverUrl} />
        <div style={{ marginTop: 20 }}>
          <DropzoneArea
            onDrop={handleDrop}
            text="Drag and drop more files here, or click to select"
          />
          <FileList files={files} onDelete={handleDeleteFile} isSender={true} />
        </div>
        <div
          style={{ color: "#e74c3c", marginBottom: "1em", fontWeight: "bold" }}
        >
          Do NOT reload or close this tab, or your files will be lost and the
          drive will stop working!
        </div>
      </div>
    );
  }
  if (step === "receiver") {
    // Determine if "Download All" button should be disabled
    const isDownloadAllDisabled = receiverFilesMeta.length === 0 || isZipping;

    return (
      <div className="container">
        <h2>Files in Drive</h2>
        <p><strong>Drive Code:</strong> {driveCode}</p> {/* Display drive code at the top */}
        <button
          onClick={startDownloadAll}
          disabled={isDownloadAllDisabled}
          style={{ marginBottom: '1em' }}
        >
          {isZipping ? `Preparing Zip (${Math.round(zipProgress)}%)` : 'Download All'}
        </button>

        {isZipping && (
          <div style={{ marginBottom: '1em' }}>
            <p>Downloading and Zipping Files...</p>
            {/* Basic progress bar */}
            <div style={{ width: '100%', backgroundColor: '#ddd', height: '20px' }}>
              <div style={{
                width: `${zipProgress}%`,
                backgroundColor: '#4CAF50',
                height: '20px',
                textAlign: 'center',
                lineHeight: '20px',
                color: 'white'
              }}>
                {/* Format progress to 2 decimal places */}
                {zipProgress.toFixed(2)}%
              </div>
            </div>
            {/* Display Speed and ETR */}
            {isZipping && zipProgress < 80 && ( // Show only during weighted download phase (0-80%)
               <div style={{ marginTop: '0.5em', fontSize: '0.9em', color: '#555' }}>
                   <span>Speed: {formatSpeed(downloadSpeed)}</span>
                   <span style={{ marginLeft: '1em' }}>ETR: {formatEtr(etr)}</span>
               </div>
            )}
            {/* REMOVED individual file progress display */}
          </div>
        )}

        <FileList
          files={receiverFilesMeta}
          onDownload={handleDownloadRequest} // Keep single file download
          isSender={false}
          isDownloading={isDownloading} // This state is for single downloads
          isZipping={isZipping} // Pass isZipping state
        />
        {/* Display errors from both App state and zip hook */}
        <ErrorBanner error={error || zipError} />
        {/* Removed "Enter New Drive Code" button */}
      </div>
    );
  }

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
