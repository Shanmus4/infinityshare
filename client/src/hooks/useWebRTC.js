import { getIceServers } from '../utils/signaling'; // Changed import
import { debugLog, LogCategory } from '../utils/debugLog';
export async function startWebRTC({ // Made async
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
  const iceServersConfig = await getIceServers(); // Fetch dynamic config
  const pc = new window.RTCPeerConnection({ iceServers: iceServersConfig });
  peerConns.current[fileId] = pc;

  const logSource = isSender ? 'SENDER' : 'RECEIVER';
  const dlog = (category, level, message, data) => {
    debugLog({ socket, driveCode, source: logSource, category, level, message, data });
  };
  pc.oniceconnectionstatechange = () => {
    dlog(LogCategory.ICE, 'info', `ICE connection state change for ${fileId}: ${pc.iceConnectionState}`);
  };
  pc.onconnectionstatechange = () => {
    dlog(LogCategory.WEBRTC, 'info', `Connection state change for ${fileId}: ${pc.connectionState}`);
     if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      dlog(LogCategory.WEBRTC, 'error', `WebRTC connection failed or disconnected for ${fileId}. State: ${pc.connectionState}`);
    }
  };
  pc.onsignalingstatechange = () => {
    dlog(LogCategory.WEBRTC, 'info', `Signaling state change for ${fileId}: ${pc.signalingState}`);
  };
  pc.onicecandidateerror = (event) => {
    dlog(LogCategory.ICE, 'error', `ICE candidate error for ${fileId}:`, { errorCode: event.errorCode, hostCandidate: event.hostCandidate, url: event.url, errorText: event.errorText });
    if (event.errorCode) {
       if (event.errorCode !== 701) {
        setError && setError(`ICE candidate gathering error for ${fileId}. Code: ${event.errorCode}`);
       } else {
        dlog(LogCategory.ICE, 'warn', `ICE candidate error 701 (ignorable) for ${fileId}: ${event.errorText}`);
       }
    } else {
      setError && setError(`ICE candidate gathering error for ${fileId}. Code: N/A`);
    }
  };
  // --- End Detailed Logging ---

  let remoteDescSet = false;
  let pendingCandidates = [];
  // Always set onicecandidate for both sender and receiver
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      dlog(LogCategory.ICE, 'info', `Gathered ICE candidate for ${fileId}`, { candidate: event.candidate.candidate });
      socket.emit('signal', { room: driveCode, fileId, data: { candidate: event.candidate } });
    } else {
       dlog(LogCategory.ICE, 'info', `End of ICE candidates for ${fileId}.`);
    }
  };
  if (isSender) {
    const dc = pc.createDataChannel('file');
    dc.binaryType = 'arraybuffer';
    dataChannels.current[fileId] = dc;
    const file = filesRef.current[fileIndex];
    dlog(LogCategory.DATACHANNEL, 'info', `Data channel created for ${fileId}`);
    dc.onopen = () => {
      dlog(LogCategory.DATACHANNEL, 'info', `Data channel opened for ${fileId}`);
      dlog(LogCategory.TRANSFER, 'info', `Sending META for ${fileId}: ${file.name}:${file.size}`);
      dc.send(`META:${file.name}:${file.size}`);
      const chunkSize = 256 * 1024; // Chunk size is 256KB
      let offset = 0;
      const MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024; // Try 4MB buffer
      dc.bufferedAmountLowThreshold = 2 * 1024 * 1024; // Set threshold to 2MB
      async function sendChunk() {
        if (offset < file.size) {
          if (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            //console.log('[WebRTC] Sender: Buffer full, waiting to drain for', fileId);
            dc.onbufferedamountlow = () => {
              dc.onbufferedamountlow = null;
              Promise.resolve().then(sendChunk);
            };
            return;
          }
          const nextChunkSize = Math.min(chunkSize, file.size - offset);
          try {
            const buffer = await file.file.slice(offset, offset + nextChunkSize).arrayBuffer();
            if (dc.readyState === 'open') {
              dc.send(buffer);
              offset += nextChunkSize;
              Promise.resolve().then(sendChunk);
            } else {
              dlog(LogCategory.DATACHANNEL, 'error', `Data channel not open: ${dc.readyState}`);
            }
          } catch (err) {
            dlog(LogCategory.DATACHANNEL, 'error', `Read/send error: ${err.message}`);
            setTimeout(() => Promise.resolve().then(sendChunk), 1000);
          }
        } else {
          dlog(LogCategory.TRANSFER, 'info', `Sending EOF for ${fileId}: ${file.name}`);
          dc.send('EOF:' + file.name);
        }
      }
      sendChunk();
    };
    dc.onerror = (event) => { // event is RTCErrorEvent
      const errorDetail = event.error ? `${event.error.name}: ${event.error.message}` : 'Unknown DataChannel error';
      dlog(LogCategory.DATACHANNEL, 'error', `DataChannel error for ${fileId}: ${errorDetail}`, { errorDetail });
    };
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      dlog(LogCategory.WEBRTC, 'info', `Emitting offer signal for ${fileId}`);
      socket.emit('signal', { room: driveCode, fileId, data: { sdp: offer } });
    });
  }
  pc.ondatachannel = (event) => {
    dlog(LogCategory.DATACHANNEL, 'info', `ondatachannel triggered for ${fileId}`);
    const dc = event.channel;
    dc.binaryType = 'arraybuffer';
    dataChannels.current[fileId] = dc;
    let filename = null;
    let expectedSize = 0;
    let receivedBytes = 0;
    let receivedChunks = [];
    let metaSent = false;
    dlog(LogCategory.DATACHANNEL, 'info', `Data channel received for ${fileId}`);

    dc.onopen = () => { // Add onopen log for receiver DC
        dlog(LogCategory.DATACHANNEL, 'info', `DataChannel opened for ${fileId}`);
    };

    dc.onmessage = async (e) => {
      // console.log('[WebRTC] Receiver: onmessage for', fileId, typeof e.data, e.data?.byteLength || e.data?.length || e.data); // Verbose log

      if (typeof e.data === 'string' && e.data.startsWith('META:')) {
        const parts = e.data.split(':');
        filename = parts.slice(1, -1).join(':');
        const sizeString = parts[parts.length - 1];
        expectedSize = parseInt(sizeString, 10);
        // console.log(`[WebRTC Single Receiver] META received for ${fileId}. Raw META: "${e.data}", Filename: ${filename}, SizeString: "${sizeString}", Parsed ExpectedSize: ${expectedSize}`); // Diagnostic log removed

        // Single download always uses SW
        if (fileId && navigator.serviceWorker.controller) {
            metaSent = true;
            // Assuming sendSWMetaAndChunk is only for single downloads now
            sendSWMetaAndChunk(fileId, null, filename, 'application/octet-stream', expectedSize);
            // console.log(`[WebRTC Single Receiver] META (with expectedSize: ${expectedSize}) sent to sendSWMetaAndChunk for SW for ${fileId}`); // Diagnostic log removed
        } else {
             console.warn('[WebRTC] Receiver: META received but no SW controller for single download', fileId);
        }
      } else if (typeof e.data === 'string' && e.data.startsWith('EOF:')) {
        dlog(LogCategory.TRANSFER, 'info', `EOF received for ${fileId}`);

        if (fileId && navigator.serviceWorker.controller) {
          dlog(LogCategory.SERVICE_WORKER, 'info', `Sending EOF to SW for ${fileId}`);
          navigator.serviceWorker.controller.postMessage({
            type: 'chunk',
            fileId: fileId,
            done: true
          });
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
    dc.onerror = (event) => { // event is RTCErrorEvent
      // Single download logic
      const errorDetail = event.error ? `${event.error.name}: ${event.error.message}` : 'Unknown DataChannel error';
      dlog(LogCategory.DATACHANNEL, 'error', `DataChannel error for ${fileId}: ${errorDetail}`, { errorDetail });
    };
    dc.onclose = () => { // Add onclose log for receiver DC
        dlog(LogCategory.DATACHANNEL, 'info', `DataChannel closed for ${fileId}`);
    };
  };
  // Process any buffered signals for this fileId (receiver side)
  if (!isSender && window.pendingSignals && window.pendingSignals[fileId]) {
    dlog(LogCategory.WEBRTC, 'info', `Processing ${window.pendingSignals[fileId].length} pending signals for ${fileId}`);
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
