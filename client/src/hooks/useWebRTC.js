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
  onComplete
}) {
  if (fileId) cleanupWebRTCInstance(fileId);
  fileId = fileId || makeFileId();
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
      const chunkSize = 64 * 1024;
      let offset = 0;
      const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8MB
      function sendChunk() {
        if (offset < file.size) {
          if (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            dc.onbufferedamountlow = () => {
              dc.onbufferedamountlow = null;
              sendChunk();
            };
            return;
          }
          const slice = file.file.slice(offset, offset + chunkSize);
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              dc.send(e.target.result);
              console.log('[WebRTC] Sender: Sent chunk for', fileId, file?.name, 'offset', offset, 'size', chunkSize);
              offset += chunkSize;
              sendChunk();
            } catch (err) {
              setError && setError('Sender: DataChannel send failed: ' + err.message);
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
    console.log('[WebRTC] Receiver: Data channel received for', fileId);
    dc.onmessage = async (e) => {
      console.log('[WebRTC] Receiver: onmessage for', fileId, typeof e.data, e.data?.byteLength || e.data?.length || e.data);
      if (typeof e.data === 'string' && e.data.startsWith('META:')) {
        const parts = e.data.split(':');
        filename = parts.slice(1, -1).join(':');
        expectedSize = parseInt(parts[parts.length - 1], 10);
        console.log('[WebRTC] Receiver: META received', filename, expectedSize);
      } else if (typeof e.data === 'string' && e.data.startsWith('EOF:')) {
        if (fileId && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ fileId: fileId, done: true });
          setTimeout(() => {}, 1000);
          cleanupWebRTCInstance(fileId);
          if (onComplete) onComplete();
          console.log('[WebRTC] Receiver: EOF received, closing for', fileId, filename);
          return;
        }
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
      } else {
        if (fileId && navigator.serviceWorker.controller) {
          sendSWMetaAndChunk(fileId, e.data, filename, expectedSize ? 'application/octet-stream' : undefined);
          console.log('[WebRTC] Receiver: Chunk received for', fileId, filename, e.data?.byteLength || e.data?.length || e.data);
        } else {
          receivedChunks.push(e.data);
        }
        receivedBytes += (e.data.byteLength || e.data.size || 0);
      }
    };
    dc.onerror = (err) => { console.error('[WebRTC] Receiver: DataChannel error', err); };
  };
} 