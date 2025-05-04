import { ICE_SERVERS } from './signaling';

/**
 * Sets up the Sender side of a WebRTC connection specifically for zip downloads.
 * Creates the RTCPeerConnection, data channel, and sends the offer/candidates
 * using the main 'signal' event.
 */
export function startZipSenderConnection({
  socket,
  transferFileId,
  driveCode,
  file, // The actual file object { name, size, file }
  peerConns, // Ref from App.js
  dataChannels, // Ref from App.js
  setError,
  cleanupWebRTCInstance // Function from App.js
}) {
  console.log(`[ZipSender] Setting up peer connection for transferId: ${transferFileId}, file: ${file?.name}`);

  if (!file) {
    console.error(`[ZipSender] No file provided for transferId: ${transferFileId}`);
    setError && setError(`ZipSender Error: No file for transfer ${transferFileId}`);
    return;
  }

  // Cleanup any existing connection for this ID *before* creating a new one
  // cleanupWebRTCInstance(transferFileId); // Let's comment this out - cleanup should happen on completion/error

  const pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConns.current[transferFileId] = pc; // Store sender PC

  // --- Detailed Logging ADDED ---
  pc.oniceconnectionstatechange = () => {
    console.log(`[ZipSender] ICE connection state change for ${transferFileId}: ${pc.iceConnectionState}`);
  };
  pc.onconnectionstatechange = () => {
    console.log(`[ZipSender] Connection state change for ${transferFileId}: ${pc.connectionState}`);
     if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      setError && setError(`ZipSender: WebRTC connection failed/disconnected for ${file.name}. State: ${pc.connectionState}`);
      cleanupWebRTCInstance(transferFileId); // Cleanup on failure
    }
  };
  pc.onsignalingstatechange = () => {
    console.log(`[ZipSender] Signaling state change for ${transferFileId}: ${pc.signalingState}`);
  };
  pc.onicecandidateerror = (event) => {
    console.error(`[ZipSender] ICE candidate error for ${transferFileId}:`, event);
    if (event.errorCode) {
       console.error(`  Error Code: ${event.errorCode}, Host Candidate: ${event.hostCandidate}, Server URL: ${event.url}, Text: ${event.errorText}`);
    }
    setError && setError(`ZipSender: ICE candidate gathering error for ${file.name}. Code: ${event.errorCode || 'N/A'}`);
    cleanupWebRTCInstance(transferFileId); // Cleanup on candidate error
  };
  // --- End Detailed Logging ---

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[ZipSender] Emitting ICE candidate for ${transferFileId}:`, event.candidate.type, event.candidate.sdpMid, event.candidate.sdpMLineIndex);
      // Use the main 'signal' event
      socket.emit('signal', { room: driveCode, fileId: transferFileId, data: { candidate: event.candidate } });
    } else {
      console.log(`[ZipSender] End of ICE candidates for ${transferFileId}.`);
    }
  };

  const dc = pc.createDataChannel('zip-file-channel'); // Use a distinct channel label?
  dc.binaryType = 'arraybuffer';
  dataChannels.current[transferFileId] = dc; // Store sender DC

  console.log(`[ZipSender] Data channel created for transferId: ${transferFileId}`);

  dc.onopen = () => {
    console.log(`[ZipSender] Data channel opened for transferId: ${transferFileId}`);
    // Send META first
    console.log(`[ZipSender] Sending META for ${transferFileId}: ${file.name}:${file.size}`);
    dc.send(`META:${file.name}:${file.size}`);

    // Configuration for sending chunks
    const chunkSize = 8 * 1024; // Keep reduced chunk size
    let offset = 0;
    const MAX_BUFFERED_AMOUNT = 512 * 1024; // Keep reduced buffer size
    dc.bufferedAmountLowThreshold = 256 * 1024;

    function sendChunk() {
      if (offset < file.size) {
        if (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            setTimeout(sendChunk, 10);
          };
          return;
        }
        const nextChunkSize = Math.min(chunkSize, file.size - offset);
        const slice = file.file.slice(offset, offset + nextChunkSize);
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            // console.log(`[ZipSender] Attempting send chunk for ${transferFileId}, offset: ${offset}, size: ${e.target.result.byteLength}`); // Too noisy
            if (dc.readyState === 'open') {
              dc.send(e.target.result);
              offset += nextChunkSize;
              // Use requestAnimationFrame for potentially smoother sending loop
              requestAnimationFrame(sendChunk);
              // setTimeout(sendChunk, 0); // Schedule next chunk send
            } else {
              console.error(`[ZipSender] Data channel not open for ${transferFileId}:`, dc.readyState);
              setError && setError(`ZipSender: DataChannel closed unexpectedly for ${file.name}`);
              cleanupWebRTCInstance(transferFileId); // Cleanup on unexpected close
            }
          } catch (err) {
            setError && setError(`ZipSender: DataChannel send failed for ${file.name}: ${err.message}`);
            console.error(`[ZipSender] DataChannel send error for ${transferFileId}:`, err);
            cleanupWebRTCInstance(transferFileId); // Cleanup on error
          }
        };
        reader.onerror = (e) => {
            console.error(`[ZipSender] FileReader error for ${transferFileId}:`, e);
            setError && setError(`ZipSender: FileReader error for ${file.name}`);
            cleanupWebRTCInstance(transferFileId); // Cleanup on error
        };
        reader.readAsArrayBuffer(slice);
      } else {
        // All chunks sent, send EOF
        console.log(`[ZipSender] Sending EOF for ${transferFileId}: ${file.name}`);
        dc.send('EOF:' + file.name);
        // Note: Sender cleanup might happen later or be triggered by receiver confirmation
      }
    }
    sendChunk(); // Start sending
  };

  dc.onerror = (err) => {
    setError && setError(`ZipSender: DataChannel error for ${file.name}.`);
    console.error(`[ZipSender] DataChannel error for transferId: ${transferFileId}`, err);
    cleanupWebRTCInstance(transferFileId); // Cleanup on error
  };

  dc.onclose = () => {
    console.log(`[ZipSender] DataChannel closed for transferId: ${transferFileId}`);
    // Consider if cleanup is needed here if closed unexpectedly before EOF
  };

  // Create and send offer
  pc.createOffer().then(offer => {
    pc.setLocalDescription(offer);
    console.log(`[ZipSender] Emitting offer signal for ${transferFileId}`);
    // Use the main 'signal' event
    socket.emit('signal', { room: driveCode, fileId: transferFileId, data: { sdp: offer } });
  }).catch(e => {
      console.error(`[ZipSender] Error creating offer for ${transferFileId}:`, e);
      setError && setError(`ZipSender: Failed to create offer for ${file.name}`);
      cleanupWebRTCInstance(transferFileId);
  });
}