    import { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ICE_SERVERS } from '../utils/signaling';

export function useZipDownload({
  receiverFilesMeta, // Full list
  driveCode,
  socket,
  cleanupWebRTCInstance,
  makeFileId,
  handleDownloadRequest, // For single file fallback if needed
  peerConns,
  dataChannels,
  pendingSignals,
  handleSignal
}) {
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [error, setError] = useState('');
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [etr, setEtr] = useState(null);
  const [zippingFolderPath, setZippingFolderPath] = useState(null); // Track which folder is zipping
  const [connectionStatus, setConnectionStatus] = useState('stable'); // 'stable', 'interrupted', 'failed'
  const [currentOperationTotalSize, setCurrentOperationTotalSize] = useState(0); // For displaying total size
  const fileData = useRef({});
  const totalBytesReceived = useRef(0);
  const lastSpeedCheckTime = useRef(0);
  const lastSpeedCheckBytes = useRef(0);
  const downloadStartTime = useRef(0);
  const currentZipOperation = useRef(null); // Stores info about the current operation { pcId, filesToDownload: Map<transferId, fileMeta>, folderPathFilter?: string }
  const heartbeatIntervalRef = useRef(null); // For receiver-side heartbeat

  const resetZipState = () => {
    setIsZipping(false);
    setZipProgress(0);
    setError('');
    setDownloadSpeed(0);
    setEtr(null);
    setZippingFolderPath(null); // Reset folder path on completion/error
    setConnectionStatus('stable'); // Reset connection status
    setCurrentOperationTotalSize(0); // Reset total size
    fileData.current = {};
    totalBytesReceived.current = 0;
    lastSpeedCheckTime.current = 0;
    lastSpeedCheckBytes.current = 0;
    downloadStartTime.current = 0;
    if (currentZipOperation.current?.pcId) {
        cleanupWebRTCInstance(currentZipOperation.current.pcId);
    }
    currentZipOperation.current = null;
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  };

  // Modified to accept an optional folderPathFilter
  const startZipProcess = useCallback(async (folderPathFilter = null) => {
    if (isZipping) {
      console.warn('[useZipDownload] Another zip operation is already in progress.');
      return;
    }
    if (!Array.isArray(receiverFilesMeta) || receiverFilesMeta.length === 0) {
      setError('No files available to download.');
      return;
    }

    // --- Filter files based on folderPathFilter if provided ---
    let filesToInclude = receiverFilesMeta;
    let zipFileName = 'InfinityShare Files.zip'; // Default name
    let isFolderDownload = false;

    if (folderPathFilter) {
      isFolderDownload = true;
      const pathPrefix = folderPathFilter + '/'; // Ensure trailing slash for prefix match

      // console.log(`[useZipDownload FILTER] Filtering for prefix: "${pathPrefix}"`); // REMOVE Log prefix

      filesToInclude = receiverFilesMeta.filter(f => {
          const starts = f.path && f.path.startsWith(pathPrefix);
          // REMOVE Log each comparison
          // console.log(`[useZipDownload FILTER] Comparing: file.path="${f.path}" | startsWith("${pathPrefix}")? ${starts}`);
          return starts;
      });


      if (filesToInclude.length === 0) {
        console.warn(`[useZipDownload] No files found within folder path: ${folderPathFilter}`);
        setError(`No files found in folder "${folderPathFilter.split('/').pop()}" to download.`);
        return;
      }
      // Set zip name based on folder
      zipFileName = `${folderPathFilter.split('/').pop() || 'folder'}.zip`;
      console.log(`[useZipDownload] Starting FOLDER download: ${folderPathFilter}, Files: ${filesToInclude.length}, Zip Name: ${zipFileName}`);
    } else {
      console.log(`[useZipDownload] Starting DOWNLOAD ALL. Files: ${filesToInclude.length}`);
      // Handle case where "Download All" is clicked with only one file
      if (filesToInclude.length === 1 && handleDownloadRequest) {
          console.log('[useZipDownload] Single file detected for Download All, triggering standard download.');
          handleDownloadRequest(filesToInclude[0].fileId);
          return; // Don't proceed with zip logic
      }
    }

    // --- Reset state and prepare for download ---
    resetZipState(); // Clear previous operation state
    setIsZipping(true); // Set zipping state for the new operation
    setZippingFolderPath(isFolderDownload ? folderPathFilter : null); // Track the folder being zipped
    downloadStartTime.current = Date.now();

    const pcId = `zip-pc-${makeFileId()}`; // Unique PC ID for this operation
    const filesToDownloadMap = new Map(); // Map<transferId, fileMeta>
    let totalSizeToDownload = 0;
    let filesDownloaded = 0;
    let receivedBytes = 0; // Use local var for progress calc within this scope

    currentZipOperation.current = { pcId, filesToDownload: filesToDownloadMap, folderPathFilter }; // Store current operation details

    // --- Setup PeerConnection ---
    // The resetZipState() called earlier should have cleaned up the previous currentZipOperation's pcId.
    // A new pcId is generated for this new operation.
    const pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConns.current[pcId] = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[useZipDownload] Gathered ICE candidate for ${pcId}: Type: ${event.candidate.type}, Address: ${event.candidate.address}, Port: ${event.candidate.port}, Protocol: ${event.candidate.protocol}`, event.candidate);
        socket.emit('signal', { room: driveCode, fileId: pcId, data: { candidate: event.candidate } });
      } else {
        console.log(`[useZipDownload] End of ICE candidates for ${pcId}.`);
      }
    };
    pc.onicecandidateerror = (event) => {
      console.error(`[useZipDownload] ICE candidate error for ${pcId}:`, event);
      if (event.errorCode) {
        console.error(`  Error Code: ${event.errorCode}, Host Candidate: ${event.hostCandidate}, Server URL: ${event.url}, Text: ${event.errorText}`);
        if (event.errorCode !== 701) { // 701 is often ignorable (e.g. TURN server not reachable)
          setError(`ICE candidate error: ${event.errorCode}`); // Use the hook's setError
        } else {
          console.warn(`[useZipDownload] ICE candidate error 701 (ignorable) for ${pcId}:`, event.errorText);
        }
      } else {
        setError('ICE candidate error (unknown code)'); // Use the hook's setError
      }
    };
    pc.onconnectionstatechange = () => {
      const newState = pc.connectionState;
      console.log(`[useZipDownload] PC connection state change for ${pcId}: ${newState}. ICE State: ${pc.iceConnectionState}, Signaling State: ${pc.signalingState}`);
      
      switch (newState) {
        case 'connected':
          setConnectionStatus('stable');
          setError(''); // Clear any previous interruption errors
          console.log(`[useZipDownload] PC ${pcId} connected.`);
          break;
        case 'disconnected':
          // This state can sometimes be temporary.
          setConnectionStatus('interrupted');
          setError('Connection interrupted. Attempting to reconnect...');
          console.warn(`[useZipDownload] PC ${pcId} disconnected. Waiting for potential auto-reconnect.`);
          // Don't resetZipState here, give it a chance to reconnect.
          break;
        case 'failed':
          setConnectionStatus('failed');
          setError('Connection lost. Please reload the page and ensure the sender tab remains open to try again.');
          console.error(`[useZipDownload] Main PC ${pcId} failed. ICE: ${pc.iceConnectionState}, Signaling: ${pc.signalingState}. Resetting zip state.`);
          resetZipState(); // For 'failed', treat as definitive and reset.
          break;
        case 'closed':
          setConnectionStatus('failed');
          // If already in a failed state from 'failed' event, don't overwrite the more specific message.
          if (connectionStatus !== 'failed' || !error.includes('Connection lost')) {
            setError('Zip download connection closed. Please try again.');
          }
          console.error(`[useZipDownload] Main PC ${pcId} closed. This is likely final.`);
          resetZipState(); // For 'closed', it's usually definitive.
          break;
        default:
          // For states like 'new', 'connecting'
          break;
      }
    };
    pc.onsignalingstatechange = () => console.log(`[useZipDownload] PC signaling state change for ${pcId}: ${pc.signalingState}. ICE State: ${pc.iceConnectionState}, Connection State: ${pc.connectionState}`);

    // --- Data Channel Handler ---
    pc.ondatachannel = (event) => {
        const dc = event.channel;
        const transferFileId = dc.label;
        console.log(`[useZipDownload] Received data channel for transferId: ${transferFileId}`);

        if (!currentZipOperation.current || !currentZipOperation.current.filesToDownload.has(transferFileId)) {
            console.error(`[useZipDownload] Received data channel for unknown/inactive transferId: ${transferFileId}`);
            dc.close(); return;
        }

        dataChannels.current[transferFileId] = dc;
        dc.binaryType = 'arraybuffer';
        dc.onopen = () => console.log(`[useZipDownload] DataChannel opened for transferId: ${transferFileId}`);

        dc.onmessage = (e) => {
            const fileMeta = currentZipOperation.current.filesToDownload.get(transferFileId);
            if (!fileMeta) return;
            const originalFileId = fileMeta.fileId;

            if (typeof e.data === 'string' && e.data.startsWith('EOF:')) {
                 filesDownloaded++;
                 console.log(`[useZipDownload] File complete: ${originalFileId} (${filesDownloaded}/${filesToInclude.length})`);
                 if (filesDownloaded === filesToInclude.length) {
                     generateZip(zipFileName, filesToInclude, folderPathFilter); // Pass necessary info
                 }
            } else if (e.data instanceof ArrayBuffer) {
                 if (!fileData.current[originalFileId]) fileData.current[originalFileId] = [];
                 fileData.current[originalFileId].push(e.data);
                 receivedBytes += e.data.byteLength;
                 totalBytesReceived.current = receivedBytes; // Update ref for speed calc

                 // Update progress (weighted 80% for download)
                 if (totalSizeToDownload > 0) {
                     const downloadWeight = 0.80;
                     const downloadPercent = (receivedBytes / totalSizeToDownload) * (100 * downloadWeight);
                     setZipProgress(downloadPercent);
                 }

                 // --- Calculate Speed and ETR (Moved back inside onmessage) ---
                 const now = Date.now();
                 // Calculate speed roughly every second or half-second
                 if (now - lastSpeedCheckTime.current > 500) { // Check every 500ms
                     const bytesSinceLastCheck = totalBytesReceived.current - lastSpeedCheckBytes.current;
                     const timeSinceLastCheck = (now - lastSpeedCheckTime.current) / 1000; // seconds

                     if (timeSinceLastCheck > 0) {
                         const currentSpeed = bytesSinceLastCheck / timeSinceLastCheck;
                         setDownloadSpeed(currentSpeed);

                         // Calculate ETR
                         // Use currentZipOperation.current.totalSize if available, otherwise fallback
                         const currentTotalSize = currentZipOperation.current?.totalSize || totalSizeToDownload || 0;
                         if (currentSpeed > 0 && currentTotalSize > 0) {
                             const bytesRemaining = currentTotalSize - totalBytesReceived.current;
                             const currentEtr = bytesRemaining / currentSpeed; // ETR in seconds
                             setEtr(currentEtr >= 0 ? currentEtr : null); // Ensure ETR is not negative
                         } else {
                             setEtr(null); // Cannot estimate if speed is 0
                         }
                     } else {
                         // Avoid division by zero if checks happen too fast
                         // Keep previous speed/ETR in this case
                     }

                     lastSpeedCheckTime.current = now;
                     lastSpeedCheckBytes.current = totalBytesReceived.current;
                 }
                 // -------------------------------------------------------
            }
        };
        dc.onerror = (err) => {
            const fileMeta = currentZipOperation.current?.filesToDownload?.get(transferFileId);
            const fileName = fileMeta?.name || transferFileId;
            console.error(`[useZipDownload] DataChannel error for transferId: ${transferFileId}, file: ${fileName}. Error:`, err);
            setError(`Error during transfer of file: ${fileName}. The "Download All" operation may be incomplete.`);
            // Not calling resetZipState() here to allow the main connection to persist if possible.
            // The download progress for the zip will stall, and this error will be visible.
            // The user can then decide to retry or the main PC state change ('closed') will eventually reset.
        };
        dc.onclose = () => {
            const fileMeta = currentZipOperation.current?.filesToDownload?.get(transferFileId);
            const fileName = fileMeta?.name || transferFileId;
            console.log(`[useZipDownload] DataChannel closed for transferId: ${transferFileId}, file: ${fileName}`);
            delete dataChannels.current[transferFileId];

            // If the overall connection hasn't failed espectadores, and an error for this specific file isn't already prominent,
            // set an error to indicate this specific file transfer was interrupted.
            // This helps explain why the zip download might be incomplete.
            if (connectionStatus !== 'failed' && !error.includes(fileName) && currentZipOperation.current) {
                 setError(prevError => {
                    const newErrorMsg = `Transfer of file: ${fileName} was interrupted (channel closed). "Download All" may be incomplete.`;
                    // Avoid duplicate messages if prevError already contains a similar message for this file.
                    if (prevError && prevError.includes(fileName)) return prevError;
                    return prevError ? `${prevError}\n${newErrorMsg}` : newErrorMsg;
                 });
            }
            // Note: We are not calling resetZipState() here. The overall operation continues,
            // but this file will be missing from the final zip if it doesn't complete.
            // The main PeerConnection state changes (e.g., 'closed' or 'failed') will handle full resets.
        };
    };

    // --- Process Pending Signals ---
    if (pendingSignals && pendingSignals.current[pcId]) {
        console.log(`[useZipDownload] Processing ${pendingSignals.current[pcId].length} pending signals for ${pcId}`);
        pendingSignals.current[pcId].forEach(signalData => handleSignal({ fileId: pcId, ...signalData }));
        delete pendingSignals.current[pcId];
    }

    // --- Initiate File Requests for the filtered list ---
    console.log(`[useZipDownload] Initiating requests for ${filesToInclude.length} files on PC: ${pcId}`);
    filesToInclude.forEach(fileMeta => {
        const transferFileId = makeFileId();
        filesToDownloadMap.set(transferFileId, fileMeta); // Store mapping for this operation
        totalSizeToDownload += fileMeta.size || 0;

        socket.emit('download-file', {
            room: driveCode,
            fileId: fileMeta.fileId,
            transferFileId: transferFileId,
            mainPcId: pcId, // Use the PC ID for this operation
            name: fileMeta.name,
            size: fileMeta.size,
            type: fileMeta.type,
            isZipRequest: !isFolderDownload, // True only for "Download All"
            isFolderRequest: isFolderDownload, // True only for folder download
            folderPath: folderPathFilter // Send null if not a folder download
        });
    });
    // Store total size after loop and update state for UI
    currentZipOperation.current.totalSize = totalSizeToDownload;
    setCurrentOperationTotalSize(totalSizeToDownload);

    // Start heartbeat for this pcId
    if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    heartbeatIntervalRef.current = setInterval(() => {
      if (socket.connected) {
        console.log(`[useZipDownload] Sending heartbeat for pcId: ${pcId}`);
        socket.emit('heartbeat-zip', { room: driveCode, pcId });
      }
    }, 15000); // Send heartbeat every 15 seconds


    // REMOVED Speed/ETR Calculation Interval - Moved into onmessage handler


  }, [isZipping, receiverFilesMeta, driveCode, socket, cleanupWebRTCInstance, makeFileId, handleDownloadRequest, peerConns, dataChannels, pendingSignals, handleSignal]);


  const generateZip = (zipFileName, filesIncludedMeta, folderPathFilter) => {
      console.log(`[useZipDownload] Generating zip: ${zipFileName}`);
      const downloadWeightPercent = 80;
      setZipProgress(downloadWeightPercent); // Mark download phase complete

      const zip = new JSZip();
      let filesAdded = 0;

      filesIncludedMeta.forEach((fileMeta) => {
          const originalFileId = fileMeta.fileId;
          if (fileData.current[originalFileId]) {
              const blob = new Blob(fileData.current[originalFileId]);
              let zipPath = fileMeta.path || fileMeta.name; // Default to full path or name

              // If it's a folder download, calculate relative path
              if (folderPathFilter) {
                  const pathPrefix = folderPathFilter.endsWith('/') ? folderPathFilter : folderPathFilter + '/';
                  if (fileMeta.path && fileMeta.path.startsWith(pathPrefix)) {
                      zipPath = fileMeta.path.substring(pathPrefix.length);
                  } else {
                      // Fallback if path doesn't match prefix (should not happen with filter)
                      zipPath = fileMeta.name;
                      console.warn(`[useZipDownload] Path "${fileMeta.path}" did not match prefix "${pathPrefix}" during folder zip generation. Using name "${fileMeta.name}".`);
                  }
              }

              // Trim leading slashes (important for both cases)
              const finalZipPathForFile = zipPath.startsWith('/') || zipPath.startsWith('\\')
                ? zipPath.substring(1)
                : zipPath;

              // Ensure path is not empty after trimming (e.g., if original path was just '/')
              if (finalZipPathForFile) {
                  // console.log(`[useZipDownload] Adding to zip: "${finalZipPathForFile}" (Original: ${fileMeta.path})`); // REMOVE Log
                  try {
                      zip.file(finalZipPathForFile, blob);
                      filesAdded++;
                  } catch (zipError) {
                       console.error(`[useZipDownload] Error adding file to zip: ID=${originalFileId}, Path="${finalZipPathForFile}"`, zipError);
                       setError(`Failed to add ${fileMeta.name} to zip.`);
                  }
              } else {
                   console.warn(`[useZipDownload] Skipping file with empty path after processing: ID=${originalFileId}, OriginalPath=${fileMeta.path}`);
              }

              delete fileData.current[originalFileId]; // Free memory
          } else {
              console.warn(`[useZipDownload] No data found for file ${fileMeta.name} (ID: ${originalFileId}) during zipping.`);
          }
      });

      if (filesAdded === 0) {
          setError("No files could be added to the zip.");
          resetZipState();
          return;
      }

      zip.generateAsync({ type: 'blob' }, (metadata) => {
          const zipWeight = 0.20;
          const zipPhaseProgress = (metadata.percent / 100) * (100 * zipWeight);
          setZipProgress(downloadWeightPercent + zipPhaseProgress);
      })
      .then(function(content) {
          console.log(`[useZipDownload] Zipping complete, triggering download as ${zipFileName}.`);
          saveAs(content, zipFileName);
          resetZipState(); // Success, reset state
      })
      .catch(err => {
          console.error(`[useZipDownload] Zipping error:`, err);
          setError('Failed to generate zip file.');
          resetZipState(); // Error, reset state
      });
  };

  // Expose the unified function and the zipping folder path, connectionStatus, and total size
  return { startZipProcess, isZipping, zipProgress, downloadSpeed, etr, error, zippingFolderPath, connectionStatus, currentOperationTotalSize };
}
