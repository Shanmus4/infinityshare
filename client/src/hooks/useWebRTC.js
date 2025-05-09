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
  onComplete // Only parameter needed besides standard ones
}) {
  if (!fileId) {
    console.error('[WebRTC] startWebRTC called without a fileId!');
    setError && setError('WebRTC Error: Missing transfer ID.');
    return;
  }
  // Cleanup any existing connection for this ID *before* creating a new one
  cleanupWebRTCInstance(fileId);
  const pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConns.current[fileId] = pc;

  // --- Detailed Logging ADDED ---
  pc.oniceconnectionstatechange = () => {
    console.log(`[WebRTC Single] ICE connection state change for ${fileId}: ${pc.iceConnectionState}`);
  };
  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC Single] Connection state change for ${fileId}: ${pc.connectionState}`);
     if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      setError && setError(`WebRTC connection failed or disconnected for ${fileId}. State: ${pc.connectionState}`);
      // Consider cleanup here too? cleanupWebRTCInstance(fileId);
    }
  };
  pc.onsignalingstatechange = () => {
    console.log(`[WebRTC Single] Signaling state change for ${fileId}: ${pc.signalingState}`);
  };
  pc.onicecandidateerror = (event) => {
    console.error(`[WebRTC Single] ICE candidate error for ${fileId}:`, event);
    if (event.errorCode) {
       console.error(`  Error Code: ${event.errorCode}, Host Candidate: ${event.hostCandidate}, Server URL: ${event.url}, Text: ${event.errorText}`);
       if (event.errorCode !== 701) {
        setError && setError(`ICE candidate gathering error for ${fileId}. Code: ${event.errorCode}`);
       } else {
        console.warn(`[WebRTC Single] ICE candidate error 701 (ignorable) for ${fileId}:`, event.errorText);
       }
    } else {
      setError && setError(`ICE candidate gathering error for ${fileId}. Code: N/A`);
    }
    // Consider cleanup here too? cleanupWebRTCInstance(fileId);
  };
  // --- End Detailed Logging ---

  let remoteDescSet = false;
  let pendingCandidates = [];
  // Always set onicecandidate for both sender and receiver
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[WebRTC Single] Emitting ICE candidate for ${fileId}:`, event.candidate.type, event.candidate.sdpMid, event.candidate.sdpMLineIndex);
      socket.emit('signal', { room: driveCode, fileId, data: { candidate: event.candidate } });
    } else {
       console.log(`[WebRTC Single] End of ICE candidates for ${fileId}.`);
    }
  };
  if (isSender) {
    const dc = pc.createDataChannel('file');
    dc.binaryType = 'arraybuffer';
    dataChannels.current[fileId] = dc;
    const file = filesRef.current[fileIndex];
    console.log(`[WebRTC Single Sender] Data channel created for ${fileId}`);
    dc.onopen = () => {
      console.log(`[WebRTC Single Sender] Data channel opened for ${fileId}`);
      console.log(`[WebRTC Single Sender] Sending META for ${fileId}: ${file.name}:${file.size}`);
      dc.send(`META:${file.name}:${file.size}`);
      const chunkSize = 8 * 1024; // Further reduced chunk size to 8KB
      let offset = 0;
      const MAX_BUFFERED_AMOUNT = 512 * 1024; // Further reduced max buffered amount to 512KB
      dc.bufferedAmountLowThreshold = 256 * 1024; // 256KB threshold
      function sendChunk() {
        if (offset < file.size) {
          if (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            //console.log('[WebRTC] Sender: Buffer full, waiting to drain for', fileId);
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
                //console.log('[WebRTC] Sender: Sent chunk for', fileId, file?.name, 'offset', offset, 'size', nextChunkSize);
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
          console.log(`[WebRTC Single Sender] Sending EOF for ${fileId}: ${file.name}`);
          dc.send('EOF:' + file.name);
        }
      }
      sendChunk();
    };
    dc.onerror = (event) => { // event is RTCErrorEvent
      // Keep minimal error logging
      console.error('[WebRTC] Sender: DataChannel error', event?.error || event);
      setError && setError(`Sender: DataChannel error: ${event?.error?.message || 'Unknown error'}`);
    };
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      console.log(`[WebRTC Single Sender] Emitting offer signal for ${fileId}`);
      socket.emit('signal', { room: driveCode, fileId, data: { sdp: offer } });
    });
  }
  pc.ondatachannel = (event) => {
    console.log(`[WebRTC Single Receiver] ondatachannel triggered for ${fileId}`);
    const dc = event.channel;
    dc.binaryType = 'arraybuffer';
    dataChannels.current[fileId] = dc;
    let filename = null;
    let expectedSize = 0;
    let receivedBytes = 0;
    let receivedChunks = [];
    let metaSent = false;
    console.log(`[WebRTC Single Receiver] Data channel received for ${fileId}`);

    dc.onopen = () => { // Add onopen log for receiver DC
        console.log(`[WebRTC Single Receiver] DataChannel opened for ${fileId}`);
    };

    dc.onmessage = async (e) => {
      // console.log('[WebRTC] Receiver: onmessage for', fileId, typeof e.data, e.data?.byteLength || e.data?.length || e.data); // Verbose log

      if (typeof e.data === 'string' && e.data.startsWith('META:')) {
        const parts = e.data.split(':');
        filename = parts.slice(1, -1).join(':');
        expectedSize = parseInt(parts[parts.length - 1], 10);
        console.log(`[WebRTC Single Receiver] META received for ${fileId}: ${filename}, Size: ${expectedSize}`);

        // Single download always uses SW
        if (fileId && navigator.serviceWorker.controller) {
            metaSent = true;
            // Assuming sendSWMetaAndChunk is only for single downloads now
            sendSWMetaAndChunk(fileId, null, filename, 'application/octet-stream', expectedSize);
            console.log(`[WebRTC Single Receiver] META sent to SW for ${fileId}`);
        } else {
             console.warn('[WebRTC] Receiver: META received but no SW controller for single download', fileId);
        }
      } else if (typeof e.data === 'string' && e.data.startsWith('EOF:')) {
        console.log(`[WebRTC Single Receiver] EOF received for ${fileId}`);

        if (fileId && navigator.serviceWorker.controller) {
          console.log(`[WebRTC Single Receiver] Sending EOF to SW for ${fileId}`);
          navigator.serviceWorker.controller.postMessage({
            type: 'chunk',
            fileId: fileId,
            done: true
          });
          console.log(`[WebRTC Single Receiver] EOF sent to SW for ${fileId}`);
          // Give SW time to process before cleaning up this specific connection
          setTimeout(() => {
            cleanupWebRTCInstance(fileId);
            if (onComplete) onComplete(); // Call original onComplete
          }, 1000);
        }
        // Fallback logic removed
     } else {
        // Single download always uses SW
        if (fileId && navigator.serviceWorker.controller) {
          // Ensure metadata was sent first
          if (!metaSent && filename) {
             console.warn('[WebRTC Single Receiver] Sending META late to SW for single download', fileId);
             metaSent = true;
             // Assuming sendSWMetaAndChunk is only for single downloads now
             sendSWMetaAndChunk(fileId, null, filename, 'application/octet-stream', expectedSize);
          }
          // Send chunk to SW
          // Assuming sendSWMetaAndChunk is only for single downloads now
          sendSWMetaAndChunk(fileId, e.data);
        }
        // Fallback logic removed
        receivedBytes += (e.data.byteLength || e.data.size || 0);
      }
    };
    dc.onerror = (err) => {
      // Single download logic
      console.error('[WebRTC] Receiver: DataChannel error during single download', fileId, err);
      setError && setError(`Receiver: DataChannel error for ${fileId}.`);
    };
    dc.onclose = () => { // Add onclose log for receiver DC
        console.log(`[WebRTC Single Receiver] DataChannel closed for ${fileId}`);
    };
  };
  // Process any buffered signals for this fileId (receiver side)
  if (!isSender && window.pendingSignals && window.pendingSignals[fileId]) {
    console.log(`[WebRTC Single Receiver] Processing ${window.pendingSignals[fileId].length} pending signals for ${fileId}`);
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
