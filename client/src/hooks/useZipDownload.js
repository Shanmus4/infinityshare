import { useState, useRef } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
// import { startWebRTC } from './useWebRTC'; // No longer used directly here for receiver
import { setupZipReceiverConnection } from '../utils/setupZipReceiverConnection'; // Import the new utility

export function useZipDownload({
  receiverFilesMeta,
  driveCode,
  socket,
  cleanupWebRTCInstance,
  makeFileId,
  handleDownloadRequest, // Still needed for single file fallback
  peerConns, // Need peerConns ref from App.js
  dataChannels // Need dataChannels ref from App.js
  // zipCallbacksRef // REMOVED - passing functions directly
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
    const transferIdToOriginalIdMap = new Map(); // Map to link transfer IDs to original file IDs
    const activeTransferIds = []; // Store active transfer IDs for cleanup

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

    // Initiate download for each file
    console.log('[useZipDownload] startDownloadAll: initiating download for', receiverFilesMeta.length, 'files');
    receiverFilesMeta.forEach(fileMeta => {
      const transferFileId = makeFileId(); // Generate a unique ID for this transfer attempt
      transferIdToOriginalIdMap.set(transferFileId, fileMeta.fileId); // Store the mapping
      activeTransferIds.push(transferFileId); // Store for cleanup
      console.log(`[useZipDownload] Setting up Zip Receiver for file: ${fileMeta.name} (originalId: ${fileMeta.fileId}, transferId: ${transferFileId})`);

      // Call the new utility function to set up the receiver connection
      const pc = setupZipReceiverConnection({
          transferFileId,
          peerConns, // Pass the main peerConns ref from App.js
          dataChannels, // Pass the main dataChannels ref from App.js
          zipCallbacks, // Pass the actual callback functions
          socket,
          driveCode
      });

      if (pc) {
          // Store the created peer connection in the shared ref IMMEDIATELY
          peerConns.current[transferFileId] = pc;
          console.log(`[useZipDownload] Stored peer connection for zip transferId: ${transferFileId}`);

          // NOW Emit download request via signaling server AFTER peer connection is set up and stored
          console.log(`[useZipDownload] Emitting download-file request for transferId: ${transferFileId}`);
          socket.emit('download-file', {
            room: driveCode,
            fileId: fileMeta.fileId, // Original file ID
            transferFileId: transferFileId, // New transfer ID
            name: fileMeta.name,
            size: fileMeta.size,
            type: fileMeta.type,
            isZipRequest: true // Add flag to indicate zip request
          });
      } else {
          console.error(`[useZipDownload] Failed to setup zip receiver connection for ${transferFileId}`);
          handleFileErrorCallback(transferFileId, new Error("Failed to setup receiver connection"));
      }
    });
  };

  // Need to adapt startWebRTC to use onChunk, onComplete, onError callbacks
  // instead of interacting with the service worker directly when these callbacks are provided.

  return { startDownloadAll, isZipping, zipProgress, downloadProgress, error };
}