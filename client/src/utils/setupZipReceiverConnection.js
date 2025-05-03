import { ICE_SERVERS } from './signaling';

/**
 * Sets up the Receiver side of a WebRTC connection specifically for zip downloads.
 * Creates the RTCPeerConnection and sets up the ondatachannel handler
 * to use the provided zip callbacks.
 * Returns the created RTCPeerConnection object.
 * This function does NOT handle signaling itself, relying on App.js's handleSignal.
 */
export function setupZipReceiverConnection({
  transferFileId,
  dataChannels, // Ref from App.js { current: { transferId: dc } }
  zipCallbacks, // Direct object with { handleFileData, handleFileComplete, handleFileError }
  socket, // Needed for emitting ICE candidates
  driveCode // Needed for emitting ICE candidates
}) {
  console.log(`[ZipReceiver] Setting up peer connection for transferId: ${transferFileId}`);

  // Check if the passed callbacks object and required functions exist
  if (!zipCallbacks || typeof zipCallbacks.handleFileData !== 'function') {
    console.error("[ZipReceiver] Zip download callbacks object not available or missing handleFileData!");
    return null; // Indicate failure
  }

  const pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      // Use the main 'signal' event for ICE, as App.js handles it
      socket.emit('signal', { room: driveCode, fileId: transferFileId, data: { candidate: event.candidate } });
    }
  };

  pc.ondatachannel = (event) => {
    console.log(`[ZipReceiver] ondatachannel triggered for zip download transferId: ${transferFileId}`);
    const dc = event.channel;
    dc.binaryType = 'arraybuffer';
    dataChannels.current[transferFileId] = dc; // Store data channel

    dc.onmessage = async (e) => {
      // Directly use callbacks from the passed object
      if (typeof e.data === 'string' && e.data.startsWith('EOF:')) {
        console.log(`[ZipReceiver] EOF received for zip transferId: ${transferFileId}`);
        if (zipCallbacks.handleFileComplete) {
          zipCallbacks.handleFileComplete(transferFileId);
        }
      } else if (e.data instanceof ArrayBuffer) {
        //console.log(`[ZipReceiver] Chunk received for zip transferId: ${transferFileId}`);
        // handleFileData is already checked for existence above
        zipCallbacks.handleFileData(transferFileId, e.data);
      } else if (typeof e.data === 'string' && e.data.startsWith('META:')) {
        console.log(`[ZipReceiver] META received for zip transferId: ${transferFileId}`);
        // Meta is handled implicitly by useZipDownload logic based on receiverFilesMeta
      }
    };

    dc.onerror = (err) => {
      console.error(`[ZipReceiver] DataChannel error for zip transferId: ${transferFileId}`, err);
      if (zipCallbacks.handleFileError) {
        zipCallbacks.handleFileError(transferFileId, err);
      }
    };

    dc.onclose = () => {
       console.log(`[ZipReceiver] DataChannel closed for zip transferId: ${transferFileId}`);
       // Optional: Trigger completion or error if closed unexpectedly?
       // Might need to call handleFileError or handleFileComplete here if state isn't EOF
    };
  };

  // Return the created peer connection so App.js can store it *before* signaling starts
  return pc;
}