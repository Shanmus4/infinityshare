import React, { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import Dropzone from 'react-dropzone';
import QRCode from 'qrcode.react';

const SIGNALING_SERVER_URL = 'wss://4cc1-49-207-206-28.ngrok-free.app';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];
const socket = io(SIGNALING_SERVER_URL, { transports: ['websocket'] });

function App() {
  // --- Initialize state based on URL (for receiver deep link) ---
  function getInitialStepAndDriveCode() {
    const pathDriveCode = window.location.pathname.slice(1).toUpperCase();
    const asReceiver = new URLSearchParams(window.location.search).get('as') === 'receiver';
    if (pathDriveCode.length === 6 && /^[A-Z0-9]+$/.test(pathDriveCode) && asReceiver) {
      return { step: 'receiver', driveCode: pathDriveCode };
    }
    return { step: 'init', driveCode: '' };
  }

  const initial = getInitialStepAndDriveCode();
  const [step, setStep] = useState(initial.step);
  const [files, setFiles] = useState([]); // File objects with fileId
  const [filesMeta, setFilesMeta] = useState([]); // {name, size, type, fileId}
  const [driveCode, setDriveCode] = useState(initial.driveCode);
  const [qrValue, setQrValue] = useState('');
  const [receiverFilesMeta, setReceiverFilesMeta] = useState([]); // For receiver
  const [error, setError] = useState('');
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());
  const [downloadProgress, setDownloadProgress] = useState(null); // {received, total, filename}
  const [downloadWriter, setDownloadWriter] = useState(null); // For streaming
  const fileBlobs = useRef({});
  const peerConns = useRef({});
  const dataChannels = useRef({});
  const filesRef = useRef(files);

  useEffect(() => { filesRef.current = files; }, [files]);

  // --- Register Service Worker ---
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js');
    }
  }, []);

  // --- Helper to generate random fileId ---
  function makeFileId() {
    return Math.random().toString(36).substr(2, 9);
  }

  // --- Defensive: only send meta ONCE per fileId ---
  const sentSWMeta = {};
  function sendSWMetaAndChunk(fileId, chunk, filename, mimetype) {
    if (filename && mimetype && !sentSWMeta[fileId]) {
      navigator.serviceWorker.controller.postMessage({ fileId, filename, mimetype });
      sentSWMeta[fileId] = true;
    }
    navigator.serviceWorker.controller.postMessage({ fileId, chunk });
  }

  // --- Defensive logging for all SW postMessages ---
  function logSWPostMessage(msg) {
    if (msg.chunk) {
      console.log('[App] Sending chunk to SW', msg.fileId, msg.chunk.byteLength);
    } else if (msg.filename) {
      console.log('[App] Sending meta to SW', msg.fileId, msg.filename, msg.mimetype);
    }
  }
  const origSWPostMessage = navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage;
  navigator.serviceWorker.controller.postMessage = function(msg) {
    logSWPostMessage(msg);
    return origSWPostMessage.apply(this, arguments);
  };

  // --- SENDER: Upload files and create drive, or add more files ---
  const handleDrop = (acceptedFiles) => {
    if (!acceptedFiles.length) return;
    if (!driveCode) {
      // First upload: create drive
      const filesWithIds = acceptedFiles.map(f => ({ file: f, fileId: makeFileId() }));
      setFiles(filesWithIds);
      filesRef.current = filesWithIds;
      setFilesMeta(filesWithIds.map(f => ({ name: f.file.name, size: f.file.size, type: f.file.type, fileId: f.fileId })));
      const code = Math.random().toString(16).slice(2, 8).toUpperCase();
      setDriveCode(code);
      setQrValue(window.location.origin + '/#' + code);
      socket.emit('create-room', code);
      setStep('uploaded');
    } else {
      // Add more files to existing drive, filter out duplicates by name+size+type
      const uniqueNewFiles = acceptedFiles.filter(f => !files.some(existing => existing.file.name === f.name && existing.file.size === f.size && existing.file.type === f.type));
      if (uniqueNewFiles.length === 0) return;
      const newFilesWithIds = uniqueNewFiles.map(f => ({ file: f, fileId: makeFileId() }));
      const newFiles = files.concat(newFilesWithIds);
      setFiles(newFiles);
      filesRef.current = newFiles;
      setFilesMeta(newFiles.map(f => ({ name: f.file.name, size: f.file.size, type: f.file.type, fileId: f.fileId })));
      socket.emit('file-list', { room: driveCode, filesMeta: newFiles.map(f => ({ name: f.file.name, size: f.file.size, type: f.file.type, fileId: f.fileId })) });
    }
  };

  useEffect(() => { filesRef.current = files; }, [files]);

  // --- SENDER: Always respond to get-file-list requests ---
  useEffect(() => {
    const handler = ({ room }) => {
      console.log('[sender] Emitting file-list', { room, filesMeta });
      socket.emit('file-list', { room, filesMeta });
    };
    socket.on('get-file-list', handler);
    return () => socket.off('get-file-list', handler);
  }, [filesMeta]);

  // --- SENDER: Send file list to new receivers on joined-room ---
  useEffect(() => {
    if (!(driveCode && filesMeta.length > 0)) return;
    const handler = () => {
      console.log('[sender] Reconnect file-list', { room: driveCode, filesMeta });
      socket.emit('file-list', { room: driveCode, filesMeta });
    };
    socket.on('connect', handler);
    return () => socket.off('connect', handler);
  }, [driveCode, filesMeta]);

  // --- SENDER: Periodically broadcast file list for late receivers ---
  useEffect(() => {
    if (!(driveCode && filesMeta.length > 0)) return;
    const interval = setInterval(() => {
      console.log('[sender] Periodic file-list', { room: driveCode, filesMeta });
      socket.emit('file-list', { room: driveCode, filesMeta });
    }, 3000); // every 3 seconds
    return () => clearInterval(interval);
  }, [driveCode, filesMeta]);

  // --- SENDER: On socket reconnect, re-emit file list ---
  useEffect(() => {
    if (!(driveCode && filesMeta.length > 0)) return;
    const handler = () => {
      console.log('[sender] Reconnect file-list', { room: driveCode, filesMeta });
      socket.emit('file-list', { room: driveCode, filesMeta });
    };
    socket.on('connect', handler);
    return () => socket.off('connect', handler);
  }, [driveCode, filesMeta]);

  // --- SENDER: Listen for download-file and start per-download WebRTC ---
  useEffect(() => {
    const downloadHandler = ({ fileId: requestedFileId, transferFileId, room, name, size, type }) => {
      let fileObj = filesRef.current.find(f => f.fileId === requestedFileId);
      // Fallback: try to match by name/size/type if fileId not found
      if (!fileObj && name && size && type) {
        fileObj = filesRef.current.find(f => f.file.name === name && f.file.size === size && f.file.type === f.type);
      }
      if (!fileObj) {
        setError('File not found for download. Please re-upload or refresh.');
        return;
      }
      // --- CRITICAL: Always use transferFileId for this download session ---
      const useTransferFileId = transferFileId || makeFileId();
      const fileIndex = filesRef.current.findIndex(f => f.fileId === fileObj.fileId);
      window.__downloadDebug = window.__downloadDebug || {};
      window.__downloadDebug[useTransferFileId] = window.__downloadDebug[useTransferFileId] || {};
      window.__downloadDebug[useTransferFileId].senderStarted = Date.now();
      window.__downloadDebug[useTransferFileId].fileName = fileObj.file.name;
      window.__downloadDebug[useTransferFileId].transferFileId = useTransferFileId;
      console.info(`[sender] Start WebRTC for download`, { fileId: requestedFileId, fileName: fileObj.file.name, transferFileId: useTransferFileId });
      startWebRTC(true, driveCode, fileIndex, undefined, null, null, useTransferFileId);
    };
    socket.on('download-file', downloadHandler);
    return () => socket.off('download-file', downloadHandler);
  }, [driveCode, files]);

  // --- RECEIVER: Robustly join and request file list after socket connects ---
  useEffect(() => {
    if (step !== 'receiver' || !driveCode) return;
    const joinAndRequest = () => {
      socket.emit('join-room', driveCode);
      socket.emit('get-file-list', { room: driveCode });
    };
    // If already connected, join immediately
    if (socket.connected) {
      joinAndRequest();
    }
    // Otherwise, wait for connect event
    socket.on('connect', joinAndRequest);
    return () => socket.off('connect', joinAndRequest);
  }, [step, driveCode]);

  // --- RECEIVER: Listen for file list ---
  useEffect(() => {
    const handler = ({ filesMeta }) => {
      console.log('[receiver] Received file-list', filesMeta);
      setReceiverFilesMeta(filesMeta || []);
    };
    socket.on('file-list', handler);
    return () => socket.off('file-list', handler);
  }, []);

  // --- RECEIVER: Download request ---
  const handleDownloadRequest = (fileId) => {
    if (downloadingFiles.has(fileId)) return;
    setDownloadingFiles(prev => new Set(prev).add(fileId));
    const fileMeta = receiverFilesMeta.find(f => f.fileId === fileId);
    if (!fileMeta) return;
    const transferFileId = makeFileId();
    const downloadUrl = `/sw-download/${transferFileId}`;
    console.log('[Download] Button clicked', { fileId, transferFileId, fileMeta });
    const newTab = window.open(downloadUrl, '_blank');
    if (!newTab) {
      setError('Popup blocked! Please allow popups for this site.');
      setDownloadingFiles(prev => { const s = new Set(prev); s.delete(fileId); return s; });
      return;
    }
    window.__downloadDebug = window.__downloadDebug || {};
    window.__downloadDebug[fileId] = { started: Date.now(), fileName: fileMeta.name, transferFileId };
    console.info(`[receiver] Download requested`, { fileId, fileName: fileMeta.name, transferFileId });
    // Timeout for stuck download detection
    setTimeout(() => {
      if (downloadingFiles.has(fileId)) {
        console.warn(`[receiver] Download stuck in starting state for 10s`, { fileId, fileName: fileMeta.name, transferFileId });
      }
    }, 10000);
    const swHandler = async (event) => {
      if (event.data.type === 'sw-ready' && event.data.fileId === transferFileId) {
        console.info(`[receiver] Service Worker ready`, { fileId, fileName: fileMeta.name, transferFileId });
        navigator.serviceWorker.controller.postMessage({ fileId: transferFileId, filename: fileMeta.name, mimetype: fileMeta.type });
        startWebRTC(false, driveCode, receiverFilesMeta.findIndex(f => f.fileId === fileId), undefined, null, null, transferFileId);
        socket.emit('download-file', { room: driveCode, fileId, transferFileId, name: fileMeta.name, size: fileMeta.size, type: fileMeta.type });
        navigator.serviceWorker.removeEventListener('message', swHandler);
      }
    };
    navigator.serviceWorker.addEventListener('message', swHandler);
  };

  useEffect(() => {
    const handler = (event) => {
      if (event.data && event.data.done && event.data.fileId) {
        const debug = window.__downloadDebug && window.__downloadDebug[event.data.fileId];
        if (debug) {
          console.info(`[receiver] Download complete`, { fileId: event.data.fileId, fileName: debug.fileName });
        }
        setDownloadingFiles(prev => { const s = new Set(prev); s.delete(event.data.fileId); return s; });
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  // --- Minimal WebRTC logic ---
  function cleanupWebRTCInstance(fileId) {
    const pc = peerConns.current[fileId];
    const dc = dataChannels.current[fileId];
    try { if (dc && dc.readyState !== 'closed') dc.close(); } catch (e) {}
    try { if (pc && pc.signalingState !== 'closed') pc.close(); } catch (e) {}
    delete peerConns.current[fileId];
    delete dataChannels.current[fileId];
  }

  function startWebRTC(isSender, code, fileIndex, roomOverride, externalWriter, downloadTab, fileId) {
    if (fileId) cleanupWebRTCInstance(fileId);
    fileId = fileId || makeFileId();
    const pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConns.current[fileId] = pc;
    let remoteDescSet = false;
    let pendingCandidates = [];
    if (isSender) {
      const dc = pc.createDataChannel('file');
      dc.binaryType = 'arraybuffer';
      dataChannels.current[fileId] = dc;
      const file = filesRef.current[fileIndex];
      dc.onopen = () => {
        console.info(`[sender] DataChannel open`, { fileId, fileName: file.file.name });
        dc.send(`META:${file.file.name}:${file.file.size}`);
        const chunkSize = 64 * 1024;
        let offset = 0;
        const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8MB
        function sendChunk() {
          if (offset < file.file.size) {
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
                offset += chunkSize;
                sendChunk();
              } catch (err) {
                setError('Sender: DataChannel send failed: ' + err.message);
                console.error(`[sender] DataChannel send failed`, { fileId, fileName: file.file.name, error: err });
              }
            };
            reader.readAsArrayBuffer(slice);
          } else {
            dc.send('EOF:' + file.file.name);
            console.info(`[sender] Sent EOF`, { fileId, fileName: file.file.name });
          }
        }
        sendChunk();
      };
      dc.onerror = (err) => {
        setError('Sender: DataChannel error.');
        console.error(`[sender] DataChannel error`, { fileId, fileName: file.file.name, error: err });
      };
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { room: roomOverride || code, fileId, data: { candidate: event.candidate } });
      }
    };
    pc.ondatachannel = (event) => {
      const dc = event.channel;
      dc.binaryType = 'arraybuffer';
      dataChannels.current[fileId] = dc;
      let filename = null;
      let expectedSize = 0;
      let receivedBytes = 0;
      let receivedChunks = [];
      dc.onmessage = async (e) => {
        if (typeof e.data === 'string' && e.data.startsWith('META:')) {
          const parts = e.data.split(':');
          filename = parts.slice(1, -1).join(':'); // handles colons in filename
          expectedSize = parseInt(parts[parts.length - 1], 10);
        } else if (typeof e.data === 'string' && e.data.startsWith('EOF:')) {
          if (fileId && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ fileId: fileId, done: true });
            setTimeout(() => {}, 1000);
            cleanupWebRTCInstance(fileId);
            console.info(`[receiver] Received EOF`, { fileId, fileName: filename });
            return;
          }
          // fallback for non-SW
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
        } else {
          if (fileId && navigator.serviceWorker.controller) {
            sendSWMetaAndChunk(fileId, e.data, filename, expectedSize ? 'application/octet-stream' : undefined);
          } else {
            receivedChunks.push(e.data);
          }
          receivedBytes += (e.data.byteLength || e.data.size || 0);
        }
      };
      dc.onerror = (err) => {
        console.error(`[receiver] DataChannel error`, { fileId, fileName: filename, error: err });
      };
    };
    socket.on('signal', function handler({ fileId: signalFileId, data }) {
      if (signalFileId !== fileId) return;
      if (data && data.sdp) {
        if (data.sdp.type === 'offer') {
          if (!remoteDescSet) {
            pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(() => {
              remoteDescSet = true;
              pc.createAnswer().then(answer => {
                pc.setLocalDescription(answer);
                socket.emit('signal', { room: roomOverride || code, fileId, data: { sdp: answer } });
              });
            }).catch(e => {/* Ignore redundant offers */});
          } // else ignore late/duplicate offers
        } else if (data.sdp.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(e => {/* Ignore redundant answers */});
          } // else ignore late/duplicate answers
        }
      } else if (data && data.candidate) {
        if (pc.remoteDescription || remoteDescSet) {
          pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
        } else {
          pendingCandidates.push(data.candidate);
        }
      }
    });
    if (isSender) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('signal', { room: roomOverride || code, fileId, data: { sdp: offer } });
      });
    }
  }

  // --- RECEIVER: Download button UI state ---
  function isDownloading(fileId) {
    return downloadingFiles.has(fileId);
  }

  // Add a delete handler for sender
  const handleDeleteFile = (fileId) => {
    // Check if file is being downloaded (by any receiver)
    // For now, check if this file is being downloaded locally (sender-side)
    // In a real app, you might want to track download state via backend or socket events
    const isDownloadingLocally = false; // Placeholder, as sender doesn't track receiver downloads
    if (downloadingFiles.has(fileId)) {
      if (!window.confirm('This file is currently being downloaded. Are you sure you want to delete it? The download will be aborted.')) {
        return;
      }
      // Stop the download locally (receiver will handle abort on their side)
      setDownloadingFiles(prev => { const s = new Set(prev); s.delete(fileId); return s; });
      // Send cancel message to service worker to abort and clean up
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ fileId, cancel: true });
      }
    }
    // Remove file from state
    const newFiles = files.filter(f => f.fileId !== fileId);
    setFiles(newFiles);
    filesRef.current = newFiles;
    const newFilesMeta = filesMeta.filter(f => f.fileId !== fileId);
    setFilesMeta(newFilesMeta);
    if (driveCode) {
      socket.emit('file-list', { room: driveCode, filesMeta: newFilesMeta });
    }
  };

  // --- UI ---
  if (step === 'init') {
    return (
      <div className="container">
        <h2>Send Files (noUSB style)</h2>
        <Dropzone onDrop={handleDrop} multiple>
          {({ getRootProps, getInputProps }) => (
            <div {...getRootProps()} style={{ border: '2px dashed #ccc', padding: 40, cursor: 'pointer', marginBottom: 20 }}>
              <input {...getInputProps()} />
              <p>Drag and drop files here, or click to select files</p>
            </div>
          )}
        </Dropzone>
        <div style={{ color: '#e74c3c', marginBottom: '1em', fontWeight: 'bold' }}>
          Files will only be available while this tab is open. Do NOT reload or close this tab.
        </div>
        <h3>Or join a drive to receive files:</h3>
        <input type="text" placeholder="Enter drive code" onKeyDown={e => { if (e.key === 'Enter') setDriveCode(e.target.value.toUpperCase()); }} style={{ marginRight: 10 }} />
        <button onClick={() => {
          const code = prompt('Enter drive code:');
          if (code) setDriveCode(code.toUpperCase());
        }}>Join Drive</button>
      </div>
    );
  }
  if (step === 'uploaded') {
    const driveUrl = `${window.location.origin}/${driveCode}`;
    const receiverUrl = `${driveUrl}?as=receiver`;
    return (
      <div className="container">
        <h2>Drive Hosting</h2>
        <QRCode value={receiverUrl} size={200} />
        <div>Drive code: <b>{driveCode}</b></div>
        <div>Share this code, QR, or link with receivers.</div>
        <div style={{ margin: '10px 0' }}>
          <input type="text" value={receiverUrl} readOnly style={{ width: '70%' }} onFocus={e => e.target.select()} />
          <button style={{ marginLeft: 8 }} onClick={() => {navigator.clipboard.writeText(receiverUrl)}}>Copy Link</button>
        </div>
        <div style={{ margin: '10px 0' }}>
          <a href={receiverUrl} target="_blank" rel="noopener noreferrer">Open Drive Link</a>
        </div>
        <div style={{ marginTop: 20 }}>
          <Dropzone onDrop={handleDrop} multiple>
            {({ getRootProps, getInputProps }) => (
              <div {...getRootProps()} style={{ border: '2px dashed #ccc', padding: 40, cursor: 'pointer', marginBottom: 20 }}>
                <input {...getInputProps()} />
                <p>Drag and drop more files here, or click to select more files</p>
              </div>
            )}
          </Dropzone>
          <table style={{ width: '100%', marginBottom: '1em', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Size</th>
                <th>Type</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {filesMeta.map((f, i) => (
                <tr key={i}>
                  <td>{f.name}</td>
                  <td>{f.size.toLocaleString()} bytes</td>
                  <td>{f.type}</td>
                  <td><button onClick={() => handleDeleteFile(f.fileId)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ color: '#e74c3c', marginBottom: '1em', fontWeight: 'bold' }}>
          Do NOT reload or close this tab, or your files will be lost and the drive will stop working!
        </div>
      </div>
    );
  }
  if (step === 'receiver') {
    return (
      <div className="container">
        <h2>Files in Drive</h2>
        <table style={{ width: '100%', marginBottom: '1em', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>File Name</th>
              <th>Size</th>
              <th>Type</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            {receiverFilesMeta.map((f, i) => (
              <tr key={i}>
                <td>{f.name}</td>
                <td>{f.size.toLocaleString()} bytes</td>
                <td>{f.type}</td>
                <td><button onClick={() => handleDownloadRequest(f.fileId)} disabled={isDownloading(f.fileId)}>{isDownloading(f.fileId) ? 'Downloading...' : 'Download'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <div style={{ color: '#e74c3c', fontWeight: 'bold' }}>{error}</div>}
        <button onClick={() => window.location.reload()}>Enter New Drive Code</button>
      </div>
    );
  }

  // If we land in receiver mode from URL, auto-join the drive on mount
  useEffect(() => {
    if (step === 'receiver' && driveCode) {
      setStep('receiver');
    }
  }, [step, driveCode]);

  // Redirect to drive if path matches /:driveCode on homepage/init step (no ?as=receiver)
  useEffect(() => {
    const pathDriveCode = window.location.pathname.slice(1).toUpperCase();
    const asReceiver = new URLSearchParams(window.location.search).get('as') === 'receiver';
    if (step === 'init' && pathDriveCode.length === 6 && /^[A-Z0-9]+$/.test(pathDriveCode) && !asReceiver) {
      setDriveCode(pathDriveCode);
    }
  }, [step]);

  return null;
}

export default App;