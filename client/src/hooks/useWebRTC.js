import { ICE_SERVERS } from '../utils/signaling';

export function startWebRTC({
  isSender,
  code,
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
  externalWriter,
  downloadTab,
  fileId,
  onComplete, // Keep existing onComplete for single file download cleanup
  onChunk, // New callback for receiving chunks (used by zip download)
  onComplete: onDownloadComplete, // New callback for download completion (used by zip download)
  onError: onDownloadError // New callback for download errors (used by zip download)
}) {
  if (!fileId) {
    console.error('[WebRTC] startWebRTC called without a fileId!');
    setError && setError('WebRTC Error: Missing transfer ID.');
    // Call the new error callback if provided
    if (onDownloadError) onDownloadError('WebRTC Error: Missing transfer ID.');
    return;
  }
  // Cleanup any existing connection for this ID *before* creating a new one
  cleanupWebRTCInstance(fileId);
  const pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConns.current[fileId] = pc;
  let remoteDescSet = false;
  let pendingCandidates = [];
  // Always set onicecandidate for both sender and receiver
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('[WebRTC] socket.emit signal (ICE)', { room: driveCode, fileId, candidate: event.candidate });
      socket.emit('signal', { room: driveCode, fileId, data: { candidate: event.candidate } });
    }
  };
  if (isSender) {
    const dc = pc.createDataChannel('file');
    dc.binaryType = 'arraybuffer';
    dataChannels.current[fileId] = dc;
    const file = filesRef.current[fileIndex];
    console.log('[WebRTC] Sender: Data channel created for', fileId, file?.name);
    dc.onopen = () => {
      console.log('[WebRTC] Sender: Data channel open for', fileId, file?.name);
      dc.send(`META:${file.name}:${file.size}`);
      const chunkSize = 16 * 1024; // Reduced from 64KB to 16KB for better reliability
      let offset = 0;
      const MAX_BUFFERED_AMOUNT = 1 * 1024 * 1024; // Reduced from 8MB to 1MB
      dc.bufferedAmountLowThreshold = 256 * 1024; // 256KB threshold
      
      function sendChunk() {
        if (offset < file.size) {
          if (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            console.log('[WebRTC] Sender: Buffer full, waiting to drain for', fileId);
            dc.onbufferedamountlow = () => {
              dc.onbufferedamountlow = null;
              setTimeout(sendChunk, 10); // Add small delay to allow processing
            };
            return;
          }
          const nextChunkSize = Math.min(chunkSize, file.size - offset);
          const slice = file.file.slice(offset, offset + nextChunkSize);
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              if (dc.readyState === 'open') {
                dc.send(e.target.result);
                console.log('[WebRTC] Sender: Sent chunk for', fileId, file?.name, 'offset', offset, 'size', nextChunkSize);
                offset += nextChunkSize;
                setTimeout(sendChunk, 0); // Use setTimeout to prevent call stack overflow
              } else {
                console.error('[WebRTC] Sender: Data channel not open:', dc.readyState);
                setError && setError('Sender: DataChannel closed unexpectedly');
              }
            } catch (err) {
              setError && setError('Sender: DataChannel send failed: ' + err.message);
              console.error('[WebRTC] Sender: DataChannel send error', err);
              // Try to recover with a delay
              setTimeout(sendChunk, 1000);
            }
          };
          reader.readAsArrayBuffer(slice);
        } else {
          dc.send('EOF:' + file.name);
          console.log('[WebRTC] Sender: Sent EOF for', fileId, file?.name);
        }
      }
      sendChunk();
    };
    dc.onerror = (err) => {
      setError && setError('Sender: DataChannel error.');
      console.error('[WebRTC] Sender: DataChannel error', err);
    };
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      console.log('[WebRTC] socket.emit signal (offer)', { room: driveCode, fileId, sdp: offer });
      socket.emit('signal', { room: driveCode, fileId, data: { sdp: offer } });
    });
  }
  pc.ondatachannel = (event) => {
    const dc = event.channel;
    dc.binaryType = 'arraybuffer';
    dataChannels.current[fileId] = dc;
    let filename = null;
    let expectedSize = 0;
    let receivedBytes = 0;
    let receivedChunks = [];
    let metaSent = false;
    console.log('[WebRTC] Receiver: Data channel received for', fileId);
    
    dc.onmessage = async (e) => {
      // console.log('[WebRTC] Receiver: onmessage for', fileId, typeof e.data, e.data?.byteLength || e.data?.length || e.data); // Verbose log

      if (typeof e.data === 'string' && e.data.startsWith('META:')) {
        const parts = e.data.split(':');
        filename = parts.slice(1, -1).join(':');
        expectedSize = parseInt(parts[parts.length - 1], 10);
        console.log('[WebRTC] Receiver: META received', filename, expectedSize);

        // If using callbacks (zip download), don't interact with SW here.
        // Otherwise (single download), send metadata to SW.
        if (!onChunk && fileId && navigator.serviceWorker.controller) {
          metaSent = true;
          sendSWMetaAndChunk(fileId, null, filename, 'application/octet-stream', expectedSize);
        }
      } else if (typeof e.data === 'string' && e.data.startsWith('EOF:')) {
        console.log('[WebRTC] Receiver: EOF received for', fileId, filename);

        // If using callbacks (zip download), call the completion callback.
        if (onDownloadComplete) {
          onDownloadComplete();
          // Note: Cleanup for zip downloads is handled by the useZipDownload hook after all files complete.
        }
        // Else if using Service Worker (single download)
        else if (fileId && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'chunk',
            fileId: fileId,
            done: true
          });
          console.log('[WebRTC] Receiver: EOF sent to SW for', fileId, filename);
          // Give SW time to process before cleaning up this specific connection
          setTimeout(() => {
            cleanupWebRTCInstance(fileId);
            if (onComplete) onComplete(); // Call original onComplete if provided
          }, 500);
        }
        // Else (fallback, should not happen with SW)
        else {
           const blob = new Blob(receivedChunks);
           const url = URL.createObjectURL(blob);
           const a = document.createElement('a');
           a.href = url;
           a.download = filename;
           document.body.appendChild(a);
           a.click();
           setTimeout(() => {
             URL.revokeObjectURL(url);
             document.body.removeChild(a);
           }, 5000);
           cleanupWebRTCInstance(fileId);
           if (onComplete) onComplete();
        }
      } else {
        // Received a data chunk (ArrayBuffer)
        if (onChunk) {
          // If using callbacks (zip download), pass chunk to the callback.
          onChunk(e.data);
          // console.log('[WebRTC] Receiver: Chunk passed to callback for', fileId, filename); // Verbose log
        }
        // Else if using Service Worker (single download)
        else if (fileId && navigator.serviceWorker.controller) {
          // Ensure metadata was sent first (fallback)
          if (!metaSent && filename) {
            metaSent = true;
            sendSWMetaAndChunk(fileId, null, filename, 'application/octet-stream', expectedSize);
          }
          sendSWMetaAndChunk(fileId, e.data);
          // console.log('[WebRTC] Receiver: Chunk sent to SW for', fileId, filename); // Verbose log
        }
        // Else (fallback, should not happen with SW)
        else {
           receivedChunks.push(e.data);
        }
        receivedBytes += (e.data.byteLength || e.data.size || 0);
      }
    };
    dc.onerror = (err) => {
      console.error('[WebRTC] Receiver: DataChannel error', err);
      // If using callbacks (zip download), call the error callback.
      if (onDownloadError) {
        onDownloadError(err);
      }
      // Otherwise (single download), use the default setError.
      else {
        setError && setError('Receiver: DataChannel error.');
      }
    };
  };
  // Process any buffered signals for this fileId (receiver side)
  if (!isSender && window.pendingSignals && window.pendingSignals[fileId]) {
    window.pendingSignals[fileId].forEach(({ data, room }) => {
      if (data && data.sdp) {
        if (data.sdp.type === 'offer') {
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(() => {
            pc.createAnswer().then(answer => {
              pc.setLocalDescription(answer);
              socket.emit('signal', { room: driveCode, fileId, data: { sdp: answer } });
            });
          });
        } else if (data.sdp.type === 'answer') {
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
      } else if (data && data.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });
    delete window.pendingSignals[fileId];
  }
}