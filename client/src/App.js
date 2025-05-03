import React, { useState, useRef, useEffect } from "react";
import FileList from "./components/FileList";
import DropzoneArea from "./components/DropzoneArea";
import QRCodeBlock from "./components/QRCodeBlock";
import DriveLinkBlock from "./components/DriveLinkBlock";
import ErrorBanner from "./components/ErrorBanner";
import { useSocket } from "./hooks/useSocket";
import { useServiceWorker } from "./hooks/useServiceWorker";
import { startWebRTC } from "./hooks/useWebRTC";
import { makeFileId } from "./utils/fileHelpers";
import { useZipDownload } from "./hooks/useZipDownload"; // Import the new hook

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
  const [files, setFiles] = useState([]); // Flat array: {name, size, type, file, fileId}
  const [driveCode, setDriveCode] = useState(initial.driveCode);
  const [joinDriveCodeInput, setJoinDriveCodeInput] = useState(''); // State for join input
  const [qrValue, setQrValue] = useState("");
  const [receiverFilesMeta, setReceiverFilesMeta] = useState([]); // Flat array for receiver
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

  // --- Register all socket event listeners at the top level ---
  useEffect(() => {
    function handleSignal({ fileId, data, room }) {
      const pc = peerConns.current[fileId];
      if (!pc) {
        // Buffer the signal for later
        if (!pendingSignals.current[fileId])
          pendingSignals.current[fileId] = [];
        pendingSignals.current[fileId].push({ data, room });
        return;
      }
      if (data && data.sdp) {
        if (data.sdp.type === "offer") {
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(
            () => {
              pc.createAnswer().then((answer) => {
                pc.setLocalDescription(answer);
                console.log("[App] socket.emit signal (answer)", {
                  room: driveCode,
                  fileId,
                  sdp: answer,
                });
                socket.emit("signal", {
                  room: driveCode,
                  fileId,
                  data: { sdp: answer },
                });
              });
            }
          );
        } else if (data.sdp.type === "answer") {
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
      } else if (data && data.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }
    socket.on("signal", handleSignal);
    return () => socket.off("signal", handleSignal);
  }, [socket, peerConns, driveCode]);

  // --- SENDER: Upload files and create drive, or add more files (flat version) ---
  const handleDrop = (acceptedFiles) => {
    if (!acceptedFiles.length) return;
    const filesWithIds = acceptedFiles.map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
      file: f,
      fileId: makeFileId(),
    }));
    // Combine new files with existing ones using the up-to-date ref
    const combinedFiles = [...filesRef.current, ...filesWithIds];
    setFiles(combinedFiles);
    // Note: filesRef.current will be updated by the useEffect hook watching 'files'

    // Generate metadata from the *combined* list
    const combinedFilesMeta = combinedFiles.map(({ name, size, type, fileId }) => ({
      name,
      size,
      type,
      fileId,
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
      const filesMeta = files.map(({ name, size, type, fileId }) => ({
        name,
        size,
        type,
        fileId,
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
      const filesMeta = files.map(({ name, size, type, fileId }) => ({
        name,
        size,
        type,
        fileId,
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
      const filesMeta = files.map(({ name, size, type, fileId }) => ({
        name,
        size,
        type,
        fileId,
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    }, 3000);
    return () => clearInterval(interval);
  }, [driveCode, files, socket]);

  // --- SENDER: On socket reconnect, re-emit file list ---
  useEffect(() => {
    if (!(driveCode && files.length > 0)) return;
    const handler = () => {
      const filesMeta = files.map(({ name, size, type, fileId }) => ({
        name,
        size,
        type,
        fileId,
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    };
    socket.on("connect", handler);
    return () => socket.off("connect", handler);
  }, [driveCode, files, socket]);

  // --- SENDER: Listen for download-file and start per-download WebRTC ---
  useEffect(() => {
    const downloadHandler = ({
      fileId: requestedFileId,
      transferFileId,
      room,
      name,
      size,
      type,
    }) => {
      console.log(`[App] Sender: Received download-file request. Original fileId: ${requestedFileId}, Transfer fileId: ${transferFileId}, Name: ${name}`); // Enhanced log

      // Always use filesRef.current to find the file
      const fileObj = filesRef.current.find(
        (f) => f.fileId === requestedFileId
      );

      if (!fileObj) {
        console.error(`[App] Sender: File not found for requestedFileId: ${requestedFileId}. filesRef.current:`, filesRef.current);
        setError("File not found for download. Please re-upload or refresh.");
        return;
      }
      console.log(`[App] Sender: Found fileObj for ${requestedFileId}:`, fileObj.name);

      const useTransferFileId = transferFileId || makeFileId(); // Should always have transferFileId from receiver
      if (!transferFileId) {
          console.warn(`[App] Sender: Missing transferFileId in request for ${requestedFileId}, generated: ${useTransferFileId}`);
      }

      const fileIndex = filesRef.current.findIndex(
        (f) => f.fileId === fileObj.fileId
      );

      if (fileIndex === -1) {
        console.error(`[App] Sender: File index not found for fileId: ${fileObj.fileId}. filesRef.current:`, filesRef.current);
        setError("File index not found for download.");
        return;
      }
      console.log(`[App] Sender: Found fileIndex ${fileIndex} for ${requestedFileId}`);

      console.log("[App] Sender: Calling startWebRTC", { // Changed log content slightly
        isSender: true,
        // fileId: requestedFileId, // Original file ID - not used by startWebRTC directly
        transferFileId: useTransferFileId, // The ID for this specific transfer
        fileIndex, // Index in sender's list
        fileName: fileObj.name,
        driveCode: driveCode,
      });

      startWebRTC({
        isSender: true,
        code: driveCode, // code and driveCode are the same? Yes.
        fileIndex,
        filesRef,
        peerConns,
        dataChannels,
        setError,
        driveCode,
        socket,
        // sendSWMetaAndChunk, // Removed unnecessary param for sender
        cleanupWebRTCInstance,
        makeFileId,
        fileId: useTransferFileId, // Pass the consistent transferFileId for WebRTC
      });
      console.log(`[App] Sender: Called startWebRTC for transferFileId: ${useTransferFileId}`);
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
      setReceiverFilesMeta(filesMeta || []);
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
        console.warn(`[receiver] Download stuck in starting state for 10s`, {
          fileId,
          fileName: fileMeta.name,
          transferFileId,
        });
      }
    }, 10000);
    const swHandler = async (event) => {
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
        console.log("[App] Receiver: emit download-file", {
          room: driveCode,
          fileId: fileMeta.fileId,
          transferFileId,
          name: fileMeta.name,
          size: fileMeta.size,
          type: fileMeta.type,
        });
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
        console.log("[App] Receiver: startWebRTC", {
          isSender: false,
          requestedFileId: fileMeta.fileId,
          transferFileId,
          fileIndex,
          fileName: fileMeta.name,
        });
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
          console.info(`[receiver] Download complete`, {
            fileId: event.data.fileId,
            fileName: debug.fileName,
          });
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
        console.log("[App] Download ready for", fileId, "at", url);
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
    downloadProgress,
    error: zipError // Alias to avoid state name conflict
  } = useZipDownload({
    receiverFilesMeta,
    driveCode,
    socket,
    cleanupWebRTCInstance,
    makeFileId,
    sendSWMetaAndChunk, // Pass the SW function for single file fallback
    handleDownloadRequest // Pass the single file download handler
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

  function sendSWMetaAndChunk(fileId, chunk, filename, mimeType, fileSize) {
    if (!navigator.serviceWorker.controller) {
      console.error("[App] No service worker controller available");
      return;
    }

    if (filename && (!chunk || chunk === null)) {
      // This is a metadata-only message
      console.log("[App] Sending metadata to SW for", fileId, filename);
      navigator.serviceWorker.controller.postMessage({
        type: "meta",
        fileId,
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
      const filesMeta = newFiles.map(({ name, size, type, fileId }) => ({
        name,
        size,
        type,
        fileId,
      }));
      socket.emit("file-list", { room: driveCode, filesMeta });
    }
  };

  const handleJoinDrive = (codeToJoin) => {
    const upperCode = codeToJoin.toUpperCase();
    // Basic validation
    if (upperCode && upperCode.length === 6 && /^[A-Z0-9]+$/.test(upperCode)) {
      setDriveCode(upperCode);
      setStep('receiver'); // Go directly to receiver step
    } else {
      setError('Invalid drive code. Must be 6 alphanumeric characters.');
      setJoinDriveCodeInput(''); // Clear invalid input
    }
  };

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
                {Math.round(zipProgress)}%
              </div>
            </div>
            {/* Optional: Display individual file progress */}
            {Object.keys(downloadProgress).length > 0 && (
              <div style={{ marginTop: '0.5em', fontSize: '0.9em' }}>
                {Object.entries(downloadProgress).map(([fileId, progress]) => {
                  const file = receiverFilesMeta.find(f => f.fileId === fileId);
                  return (
                    <div key={fileId}>{file?.name || fileId}: {Math.round(progress)}%</div>
                  );
                })}
              </div>
            )}
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
