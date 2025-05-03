import { useState, useRef } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { startWebRTC } from './useWebRTC'; // We will adapt this or use callbacks

export function useZipDownload({ receiverFilesMeta, driveCode, socket, cleanupWebRTCInstance, makeFileId, sendSWMetaAndChunk, handleDownloadRequest }) {
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0); // 0 to 100
  const [downloadProgress, setDownloadProgress] = useState({}); // { fileId: progress }
  const [error, setError] = useState('');

  const fileData = useRef({}); // To store received file chunks/Blobs before zipping
  const peerConns = useRef({}); // Need to manage peer connections for multiple files
  const dataChannels = useRef({}); // Need to manage data channels for multiple files

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

    const zip = new JSZip();
    let filesDownloaded = 0;

    // Function to handle receiving data for a single file
    const handleFileData = (fileId, chunk) => {
      if (!fileData.current[fileId]) {
        fileData.current[fileId] = [];
      }
      fileData.current[fileId].push(chunk);
      // Update individual file download progress (optional but good UX)
      const fileMeta = receiverFilesMeta.find(f => f.fileId === fileId);
      if (fileMeta && fileMeta.size > 0) {
         const receivedSize = fileData.current[fileId].reduce((sum, c) => sum + c.byteLength, 0);
         setDownloadProgress(prev => ({
           ...prev,
           [fileId]: (receivedSize / fileMeta.size) * 100
         }));
      }
    };

    const handleFileComplete = (fileId) => {
       filesDownloaded++;
       console.log(`[useZipDownload] File ${fileId} complete. ${filesDownloaded}/${receiverFilesMeta.length} files received.`);
       // Update overall progress based on files received
       setZipProgress((filesDownloaded / receiverFilesMeta.length) * 50); // First 50% for downloading

       // Check if all files are downloaded
       if (filesDownloaded === receiverFilesMeta.length) {
         console.log('[useZipDownload] All files downloaded, starting zipping.');
         setZipProgress(50); // Transition to zipping phase

         // Start zipping
         receiverFilesMeta.forEach(fileMeta => {
           if (fileData.current[fileMeta.fileId]) {
             const blob = new Blob(fileData.current[fileMeta.fileId]);
             zip.file(fileMeta.name, blob);
             delete fileData.current[fileMeta.fileId]; // Free up memory
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
           // Cleanup all peer connections
           receiverFilesMeta.forEach(fileMeta => cleanupWebRTCInstance(fileMeta.fileId));
         })
         .catch(err => {
           console.error('[useZipDownload] Zipping error:', err);
           setError('Failed to zip files.');
           setIsZipping(false);
           setZipProgress(0);
           setDownloadProgress({});
           // Cleanup all peer connections
           receiverFilesMeta.forEach(fileMeta => cleanupWebRTCInstance(fileMeta.fileId));
         });
       }
    };

    const handleFileError = (fileId, err) => {
      console.error(`[useZipDownload] Error downloading file ${fileId}:`, err);
      setError(`Error downloading file: ${receiverFilesMeta.find(f => f.fileId === fileId)?.name || fileId}`);
      setIsZipping(false);
      setZipProgress(0);
      setDownloadProgress({});
      // Attempt to cleanup the specific connection
      cleanupWebRTCInstance(fileId);
      // Note: If one file fails, the whole zip download might need to be cancelled or handled.
      // For simplicity, we'll just show an error and stop.
    };


    // Initiate download for each file
    receiverFilesMeta.forEach(fileMeta => {
      const transferFileId = makeFileId(); // Generate a unique ID for this transfer attempt
      console.log('[useZipDownload] Initiating WebRTC for file:', fileMeta.name, 'with transfer ID:', transferFileId);

      // Emit download request via signaling server
      socket.emit('download-file', {
        room: driveCode,
        fileId: fileMeta.fileId, // Original file ID
        transferFileId: transferFileId, // New transfer ID
        name: fileMeta.name,
        size: fileMeta.size,
        type: fileMeta.type,
      });

      // Start WebRTC connection for this file
      startWebRTC({
        isSender: false, // We are the receiver
        code: driveCode,
        fileIndex: receiverFilesMeta.findIndex(f => f.fileId === fileMeta.fileId), // Index might not be needed if we use fileId consistently
        filesRef: { current: receiverFilesMeta }, // Pass receiver's file list
        peerConns, // Pass refs for managing connections
        dataChannels, // Pass refs for managing data channels
        setError: (msg) => handleFileError(transferFileId, msg), // Use local error handler
        driveCode,
        socket,
        cleanupWebRTCInstance, // Pass cleanup function
        makeFileId, // Pass makeFileId
        fileId: transferFileId, // Use the consistent transfer ID for WebRTC
        // Provide callbacks for data handling instead of using service worker
        onChunk: (chunk) => handleFileData(transferFileId, chunk),
        onComplete: () => handleFileComplete(transferFileId),
        onError: (err) => handleFileError(transferFileId, err),
        // Do NOT pass sendSWMetaAndChunk, externalWriter, downloadTab
      });
    });
  };

  // Need to adapt startWebRTC to use onChunk, onComplete, onError callbacks
  // instead of interacting with the service worker directly when these callbacks are provided.

  return { startDownloadAll, isZipping, zipProgress, downloadProgress, error };
}