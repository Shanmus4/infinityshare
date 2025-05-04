import { useState, useRef } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
// import { startWebRTC } from './useWebRTC'; // No longer used directly here for receiver
import { setupZipReceiverConnection } from '../utils/setupZipReceiverConnection'; // Import the new utility
import { ICE_SERVERS } from '../utils/signaling'; // Import ICE_SERVERS

export function useZipDownload({
  receiverFilesMeta,
  driveCode,
  socket,
  cleanupWebRTCInstance,
  makeFileId,
  handleDownloadRequest, // Still needed for single file fallback
  peerConns, // Need peerConns ref from App.js
  dataChannels, // Need dataChannels ref from App.js
  pendingSignals, // Ref from App.js for buffered signals
  handleSignal // Function from App.js to process signals
}) {
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0); // 0 to 100
  const [downloadProgress, setDownloadProgress] = useState({}); // { fileId: progress } - keyed by originalFileId
  const [error, setError] = useState('');

  const fileData = useRef({}); // To store received file chunks/Blobs before zipping
  // REMOVED internal refs - use refs passed from App.js via props
  // const peerConns = useRef({});
  // const dataChannels = useRef({});

  const startDownloadAll = async () => {
    if (!receiverFilesMeta || receiverFilesMeta.length === 0) {
      setError('No files to download.');
      return;
    }

    if (receiverFilesMeta.length === 1) {
      // If only one file, trigger the standard single file download
      const fileMeta = receiverFilesMeta[0];
      console.log('[useZipDownload] Single file detected, triggering standard download for:', fileMeta.name);
      if (handleDownloadRequest) {
        handleDownloadRequest(fileMeta.fileId);
      } else {
        setError('Single file download handler is not available.');
      }
      return; // Don't proceed with zip logic
    }

    setIsZipping(true);
    setZipProgress(0);
    setDownloadProgress({});
    setError('');
    fileData.current = {}; // Clear previous data
    const transferIdToOriginalIdMap = new Map(); // Map channel labels (transfer IDs) to original file IDs
    const activeTransferIds = []; // Store active transfer IDs (channel labels) for cleanup/tracking

    const zip = new JSZip();
    let filesDownloaded = 0;

    // Define callbacks locally
    const handleFileDataCallback = (transferFileId, chunk) => {
      const originalFileId = transferIdToOriginalIdMap.get(transferFileId);
      if (!originalFileId) {
        console.error(`[useZipDownload] handleFileData: No originalFileId found for transferFileId ${transferFileId}`);
        return;
      }
      //console.log('[useZipDownload] handleFileData called for originalFileId', originalFileId, 'from transferFileId', transferFileId, 'chunk length', chunk.byteLength);

      // Store data keyed by the original file ID
      if (!fileData.current[originalFileId]) {
        //console.log('[useZipDownload] handleFileData: creating new array for originalFileId', originalFileId);
        fileData.current[originalFileId] = [];
      }
      fileData.current[originalFileId].push(chunk);

      // Update individual file download progress (optional but good UX)
      // Find meta using the original file ID
      const fileMeta = receiverFilesMeta.find(f => f.fileId === originalFileId);
      if (fileMeta && fileMeta.size > 0) {
         const receivedSize = fileData.current[originalFileId].reduce((sum, c) => sum + c.byteLength, 0);
         //console.log('[useZipDownload] handleFileData: originalFileId', originalFileId, 'receivedSize', receivedSize, 'fileSize', fileMeta.size);
         // Update progress state keyed by the original file ID
         setDownloadProgress(prev => ({
           ...prev,
           [originalFileId]: (receivedSize / fileMeta.size) * 100
         }));
      }
    };

    const handleFileCompleteCallback = (transferFileId) => {
       const originalFileId = transferIdToOriginalIdMap.get(transferFileId);
       if (!originalFileId) {
         console.error(`[useZipDownload] handleFileComplete: No originalFileId found for transferFileId ${transferFileId}`);
         return;
       }
       filesDownloaded++;
       console.log(`[useZipDownload] File complete (originalId: ${originalFileId}, transferId: ${transferFileId}). ${filesDownloaded}/${receiverFilesMeta.length} files received.`);
       // Update overall progress based on files received
       setZipProgress((filesDownloaded / receiverFilesMeta.length) * 50); // First 50% for downloading

       // Check if all files are downloaded
       if (filesDownloaded === receiverFilesMeta.length) {
         console.log('[useZipDownload] All files downloaded, starting zipping.');
         setZipProgress(50); // Transition to zipping phase

         // Start zipping - uses originalFileId from receiverFilesMeta to access fileData.current
         receiverFilesMeta.forEach(fileMeta => {
           if (fileData.current[fileMeta.fileId]) {
             const blob = new Blob(fileData.current[fileMeta.fileId]);
             zip.file(fileMeta.name, blob);
             delete fileData.current[fileMeta.fileId]; // Free up memory
           } else {
             console.warn(`[useZipDownload] No data found for file ${fileMeta.name} (ID: ${fileMeta.fileId}) during zipping.`);
           }
         });

         zip.generateAsync({ type: 'blob' }, (metadata) => {
           // Update zipping progress (remaining 50%)
           setZipProgress(50 + metadata.percent / 2);
         })
         .then(function(content) {
           console.log('[useZipDownload] Zipping complete, triggering download.');
           saveAs(content, 'files.zip');
           setIsZipping(false);
           setZipProgress(100);
           setDownloadProgress({});
           // Cleanup all peer connections using the stored transfer IDs
           console.log('[useZipDownload] Cleaning up WebRTC instances for transfers:', activeTransferIds);
           activeTransferIds.forEach(id => cleanupWebRTCInstance(id));
         })
         .catch(err => {
           console.error('[useZipDownload] Zipping error:', err);
           setError('Failed to zip files.');
           setIsZipping(false);
           setZipProgress(0);
           setDownloadProgress({});
           // Cleanup all peer connections using the stored transfer IDs
           console.log('[useZipDownload] Cleaning up WebRTC instances after zip error:', activeTransferIds);
           activeTransferIds.forEach(id => cleanupWebRTCInstance(id));
         });
       }
    };

    const handleFileErrorCallback = (transferFileId, err) => {
      const originalFileId = transferIdToOriginalIdMap.get(transferFileId);
      const fileName = receiverFilesMeta.find(f => f.fileId === originalFileId)?.name || originalFileId || transferFileId;
      console.error(`[useZipDownload] Error downloading file (originalId: ${originalFileId}, transferId: ${transferFileId}, name: ${fileName}):`, err);
      setError(`Error downloading file: ${fileName}`);
      setIsZipping(false);
      setZipProgress(0);
      setDownloadProgress({});
      // Attempt to cleanup the specific connection using transferFileId
      cleanupWebRTCInstance(transferFileId);
      // Note: If one file fails, the whole zip download might need to be cancelled or handled.
      // For simplicity here, we stop and cleanup the failed connection.
      // Consider cleaning up all active connections if one fails.
    };

    // REMOVED logic to update zipCallbacksRef

    // Define the callbacks object to pass directly
    const zipCallbacks = {
        handleFileData: handleFileDataCallback,
        handleFileComplete: handleFileCompleteCallback,
        handleFileError: handleFileErrorCallback,
    };

    // --- Create ONE PeerConnection for the entire zip transfer ---
    const mainZipPcId = `zip-pc-${makeFileId()}`; // Unique ID for this zip download attempt's PC
    console.log(`[useZipDownload] Creating main PeerConnection for zip download: ${mainZipPcId}`);
    cleanupWebRTCInstance(mainZipPcId); // Clean up any previous main zip PC for this hook instance

    // Ensure ICE servers are available (read from signaling.js, handled by App.js import)
    // We assume ICE_SERVERS is correctly imported and available via setupZipReceiverConnection's scope or passed if needed.
    // For simplicity, let's assume setupZipReceiverConnection handles ICE_SERVERS internally for now.
    // If not, we'd need to import ICE_SERVERS here or pass it down.

    const pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS }); // Use imported ICE_SERVERS
    peerConns.current[mainZipPcId] = pc; // Store the single PC

    // --- Setup Handlers for the Main PC ---

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[useZipDownload] Emitting ICE candidate for main zip connection ${mainZipPcId}`);
        socket.emit('signal', { room: driveCode, fileId: mainZipPcId, data: { candidate: event.candidate } });
      } else {
        console.log(`[useZipDownload] End of ICE candidates for ${mainZipPcId}.`);
      }
    };

    pc.onicecandidateerror = (event) => {
      // Log non-fatal errors, let connection state handle fatal ones
      console.error(`[useZipDownload] Main zip PC ICE candidate error for ${mainZipPcId}:`, event);
       if (event.errorCode) {
           console.error(`  Error Code: ${event.errorCode}, Host Candidate: ${event.hostCandidate}, Server URL: ${event.url}, Text: ${event.errorText}`);
       }
       // Don't trigger handleFileErrorCallback here for the whole zip
    };

    pc.onconnectionstatechange = () => {
      console.log(`[useZipDownload] Main zip PC connection state change for ${mainZipPcId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
         console.error(`[useZipDownload] Main zip PC ${mainZipPcId} failed/disconnected/closed.`);
         setError('Zip download connection failed.');
         setIsZipping(false);
         setZipProgress(0);
         setDownloadProgress({});
         // Cleanup the main PC and potentially associated channels?
         cleanupWebRTCInstance(mainZipPcId);
         // Also cleanup any channels associated with this failed PC?
         activeTransferIds.forEach(id => {
             // We might need a more robust way to track channels associated with this PC
             // For now, assume cleanupWebRTCInstance handles related resources if needed,
             // or enhance cleanupWebRTCInstance later.
             delete dataChannels.current[id]; // Remove channel refs
         });
      }
    };

     pc.onsignalingstatechange = () => {
       console.log(`[useZipDownload] Main zip PC signaling state change for ${mainZipPcId}: ${pc.signalingState}`);
     };

    // --- Central Data Channel Handler ---
    pc.ondatachannel = (event) => {
        const dc = event.channel;
        const transferFileId = dc.label; // Get the transfer ID (channel label)
        console.log(`[useZipDownload] Received data channel request for transferId: ${transferFileId}`);

        if (!transferIdToOriginalIdMap.has(transferFileId)) {
            console.error(`[useZipDownload] Received data channel for unknown transferId/label: ${transferFileId}`);
            dc.close(); // Close unexpected channels
            return;
        }

        dataChannels.current[transferFileId] = dc; // Store channel by its label/transferId
        dc.binaryType = 'arraybuffer';

        dc.onopen = () => {
            console.log(`[useZipDownload] DataChannel opened for transferId: ${transferFileId}`);
        };

        dc.onmessage = (e) => {
            // Use the existing callbacks, passing the correct transferFileId
            if (typeof e.data === 'string' && e.data.startsWith('EOF:')) {
                 if (zipCallbacks.handleFileComplete) zipCallbacks.handleFileComplete(transferFileId);
            } else if (e.data instanceof ArrayBuffer) {
                 if (zipCallbacks.handleFileData) zipCallbacks.handleFileData(transferFileId, e.data);
            } else if (typeof e.data === 'string' && e.data.startsWith('META:')) {
                 console.log(`[useZipDownload] META received (and ignored by receiver) for transferId: ${transferFileId}`);
                 // Meta is handled by sender setting up the channel
            } else {
                 console.warn(`[useZipDownload] Received unexpected message type for ${transferFileId}:`, typeof e.data);
            }
        };

        dc.onerror = (err) => {
            console.error(`[useZipDownload] DataChannel error for transferId: ${transferFileId}`, err);
            // Trigger error for the specific file, not the whole zip (unless desired)
            if (zipCallbacks.handleFileError) zipCallbacks.handleFileError(transferFileId, err);
            // Should we remove this channel from dataChannels ref?
            delete dataChannels.current[transferFileId];
        };

        dc.onclose = () => {
            console.log(`[useZipDownload] DataChannel closed for transferId: ${transferFileId}`);
            // Check if file was completed? If not, maybe trigger error?
            // This might be redundant if onerror or handleFileComplete already handled it.
            delete dataChannels.current[transferFileId]; // Clean up ref on close
        };
    };

    // --- Process Pending Signals for the Main PC ---
    // Note: App.js needs to be updated to use mainZipPcId for zip signals
    if (pendingSignals && pendingSignals.current[mainZipPcId]) {
        console.log(`[useZipDownload] Processing ${pendingSignals.current[mainZipPcId].length} pending signals for ${mainZipPcId}`);
        pendingSignals.current[mainZipPcId].forEach(signalData => {
          // Assuming handleSignal is correctly passed and handles { fileId: mainZipPcId, ... }
          handleSignal({ fileId: mainZipPcId, ...signalData });
        });
        delete pendingSignals.current[mainZipPcId];
    }

    // --- Initiate Channel Requests Sequentially ---
    console.log('[useZipDownload] Initiating data channel requests for', receiverFilesMeta.length, 'files on PC:', mainZipPcId);
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); // Keep delay helper

    for (const fileMeta of receiverFilesMeta) {
        const transferFileId = makeFileId(); // ID for the channel and file data tracking
        transferIdToOriginalIdMap.set(transferFileId, fileMeta.fileId);
        activeTransferIds.push(transferFileId); // Track active channels

        console.log(`[useZipDownload] Emitting download-file request for originalId: ${fileMeta.fileId}, channelLabel: ${transferFileId}, using mainPcId: ${mainZipPcId}`);
        socket.emit('download-file', {
            room: driveCode,
            fileId: fileMeta.fileId,        // Original ID for sender lookup
            transferFileId: transferFileId, // Unique ID for this specific file transfer / channel label
            mainPcId: mainZipPcId,          // ID of the single PeerConnection to use/create
            name: fileMeta.name,
            size: fileMeta.size,
            type: fileMeta.type,
            isZipRequest: true
        });

        // Keep delay between *requests* to potentially avoid overwhelming sender/signaling
        console.log(`[useZipDownload] Waiting 500ms before next file request...`); // Reduced delay slightly
        await delay(500);
    }
  };

  // Need to adapt startWebRTC to use onChunk, onComplete, onError callbacks
  // instead of interacting with the service worker directly when these callbacks are provided.

  return { startDownloadAll, isZipping, zipProgress, downloadProgress, error };
}