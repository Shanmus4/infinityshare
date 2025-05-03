import React, { useState, useRef, useEffect } from 'react';
import FileList from './components/FileList';
import DropzoneArea from './components/DropzoneArea';
import QRCodeBlock from './components/QRCodeBlock';
import DriveLinkBlock from './components/DriveLinkBlock';
import ErrorBanner from './components/ErrorBanner';
import { useSocket } from './hooks/useSocket';
import { useServiceWorker } from './hooks/useServiceWorker';
import { startWebRTC } from './hooks/useWebRTC';
import { makeFileId } from './utils/fileHelpers';

function App() {
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
  const [files, setFiles] = useState([]); // Flat array: {name, size, type, file, fileId}
  const [driveCode, setDriveCode] = useState(initial.driveCode);
  const [qrValue, setQrValue] = useState('');
  const [receiverFilesMeta, setReceiverFilesMeta] = useState([]); // Flat array for receiver
  const [error, setError] = useState('');
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());
  const fileBlobs = useRef({});
  const peerConns = useRef({});
  const dataChannels = useRef({});
  const filesRef = useRef(files);
  const socket = useSocket();
  const { postMessage } = useServiceWorker();

  useEffect(() => { filesRef.current = files; }, [files]);

  // --- Register all socket event listeners at the top level ---
  useEffect(() => {
    function handleSignal({ fileId, data, room }) {
      const pc = peerConns.current[fileId];
      if (!pc) return;
      if (data && data.sdp) {
        if (data.sdp.type === 'offer') {
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(() => {
            pc.createAnswer().then(answer => {
              pc.setLocalDescription(answer);
              console.log('[App] socket.emit signal (answer)', { room: driveCode, fileId, sdp: answer });
              socket.emit('signal', { room: driveCode, fileId, data: { sdp: answer } });
            });
          });
        } else if (data.sdp.type === 'answer') {
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
      } else if (data && data.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }
    socket.on('signal', handleSignal);
    return () => socket.off('signal', handleSignal);
  }, [socket, peerConns, driveCode]);

  // --- SENDER: Upload files and create drive, or add more files (flat version) ---
  const handleDrop = (acceptedFiles) => {
    if (!acceptedFiles.length) return;
    const filesWithIds = acceptedFiles.map(f => ({
      name: f.name,
      size: f.size,
      type: f.type,
      file: f,
      fileId: makeFileId()
    }));
    setFiles(filesWithIds);
    filesRef.current = filesWithIds;
    const filesMeta = filesWithIds.map(({ name, size, type, fileId }) => ({ name, size, type, fileId }));
    if (!driveCode) {
      const code = Math.random().toString(16).slice(2, 8).toUpperCase();
      setDriveCode(code);
      setQrValue(window.location.origin + '/#' + code);
      socket.emit('create-room', code);
      setStep('uploaded');
      socket.emit('file-list', { room: code, filesMeta });
    } else {
      socket.emit('file-list', { room: driveCode, filesMeta });
    }
  };

  // --- SENDER: Always respond to get-file-list requests ---
  useEffect(() => {
    const handler = ({ room }) => {
      const filesMeta = files.map(({ name, size, type, fileId }) => ({ name, size, type, fileId }));
      socket.emit('file-list', { room, filesMeta });
    };
    socket.on('get-file-list', handler);
    return () => socket.off('get-file-list', handler);
  }, [files, socket]);

  // --- SENDER: Send file list to new receivers on joined-room ---
  useEffect(() => {
    if (!(driveCode && files.length > 0)) return;
    const handler = () => {
      const filesMeta = files.map(({ name, size, type, fileId }) => ({ name, size, type, fileId }));
      socket.emit('file-list', { room: driveCode, filesMeta });
    };
    socket.on('connect', handler);
    return () => socket.off('connect', handler);
  }, [driveCode, files, socket]);

  // --- SENDER: Periodically broadcast file list for late receivers ---
  useEffect(() => {
    if (!(driveCode && files.length > 0)) return;
    const interval = setInterval(() => {
      const filesMeta = files.map(({ name, size, type, fileId }) => ({ name, size, type, fileId }));
      socket.emit('file-list', { room: driveCode, filesMeta });
    }, 3000);
    return () => clearInterval(interval);
  }, [driveCode, files, socket]);

  // --- SENDER: On socket reconnect, re-emit file list ---
  useEffect(() => {
    if (!(driveCode && files.length > 0)) return;
    const handler = () => {
      const filesMeta = files.map(({ name, size, type, fileId }) => ({ name, size, type, fileId }));
      socket.emit('file-list', { room: driveCode, filesMeta });
    };
    socket.on('connect', handler);
    return () => socket.off('connect', handler);
  }, [driveCode, files, socket]);

  // --- SENDER: Listen for download-file and start per-download WebRTC ---
  useEffect(() => {
    const downloadHandler = ({ fileId: requestedFileId, transferFileId, room, name, size, type }) => {
      // Always use filesRef.current to find the file
      const fileObj = filesRef.current.find(f => f.fileId === requestedFileId);
      if (!fileObj) {
        setError('File not found for download. Please re-upload or refresh.');
        return;
      }
      const useTransferFileId = transferFileId || makeFileId();
      const fileIndex = filesRef.current.findIndex(f => f.fileId === fileObj.fileId);
      if (fileIndex === -1) {
        setError('File index not found for download.');
        return;
      }
      console.log('[App] Sender: startWebRTC', { isSender: true, fileId: requestedFileId, transferFileId: useTransferFileId, fileIndex, fileName: fileObj.name });
      startWebRTC({
        isSender: true,
        code: driveCode,
        fileIndex,
        filesRef,
        peerConns,
        dataChannels,
        setError,
        driveCode,
        socket,
        sendSWMetaAndChunk,
        cleanupWebRTCInstance,
        makeFileId
      });
    };
    socket.on('download-file', downloadHandler);
    return () => socket.off('download-file', downloadHandler);
  }, [socket, driveCode]);

  // --- RECEIVER: Robustly join and request file list after socket connects ---
  useEffect(() => {
    if (step !== 'receiver' || !driveCode) return;
    const joinAndRequest = () => {
      socket.emit('join-room', driveCode);
      socket.emit('get-file-list', { room: driveCode });
    };
    if (socket.connected) {
      joinAndRequest();
    }
    socket.on('connect', joinAndRequest);
    return () => socket.off('connect', joinAndRequest);
  }, [step, driveCode, socket]);

  // --- RECEIVER: Listen for file list ---
  useEffect(() => {
    const handler = ({ filesMeta }) => {
      setReceiverFilesMeta(filesMeta || []);
    };
    socket.on('file-list', handler);
    return () => socket.off('file-list', handler);
  }, [socket]);

  // --- RECEIVER: Download request ---
  const handleDownloadRequest = (fileId) => {
    if (downloadingFiles.has(fileId)) return;
    setDownloadingFiles(prev => new Set(prev).add(fileId));
    const fileMeta = receiverFilesMeta.find(f => f.fileId === fileId);
    if (!fileMeta) return;
    const transferFileId = makeFileId();
    const downloadUrl = `/sw-download/${transferFileId}`;
    const newTab = window.open(downloadUrl, '_blank');
    if (!newTab) {
      setError('Popup blocked! Please allow popups for this site.');
      setDownloadingFiles(prev => { const s = new Set(prev); s.delete(fileId); return s; });
      return;
    }
    window.__downloadDebug = window.__downloadDebug || {};
    window.__downloadDebug[fileId] = { started: Date.now(), fileName: fileMeta.name, transferFileId };
    setTimeout(() => {
      if (downloadingFiles.has(fileId)) {
        console.warn(`[receiver] Download stuck in starting state for 10s`, { fileId, fileName: fileMeta.name, transferFileId });
      }
    }, 10000);
    const swHandler = async (event) => {
      if (event.data.type === 'sw-ready' && event.data.fileId === transferFileId) {
        postMessage({ fileId: transferFileId, filename: fileMeta.name, mimetype: fileMeta.type });
        console.log('[App] Receiver: emit download-file', { room: driveCode, fileId, transferFileId, name: fileMeta.name, size: fileMeta.size, type: fileMeta.type });
        socket.emit('download-file', { room: driveCode, fileId, transferFileId, name: fileMeta.name, size: fileMeta.size, type: fileMeta.type });
        const fileIndex = receiverFilesMeta.findIndex(f => f.fileId === fileId);
        console.log('[App] Receiver: startWebRTC', { isSender: false, fileId, transferFileId, fileIndex, fileName: fileMeta.name });
        startWebRTC({
          isSender: false,
          code: driveCode,
          fileIndex,
          filesRef: { current: receiverFilesMeta },
          peerConns,
          dataChannels,
          setError,
          driveCode,
          socket,
          sendSWMetaAndChunk,
          cleanupWebRTCInstance,
          makeFileId
        });
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

  // --- Minimal WebRTC logic helpers ---
  function cleanupWebRTCInstance(fileId) {
    const pc = peerConns.current[fileId];
    const dc = dataChannels.current[fileId];
    try { if (dc && dc.readyState !== 'closed') dc.close(); } catch (e) {}
    try { if (pc && pc.signalingState !== 'closed') pc.close(); } catch (e) {}
    delete peerConns.current[fileId];
    delete dataChannels.current[fileId];
  }

  function sendSWMetaAndChunk(fileId, chunk, filename, mimetype) {
    if (filename && mimetype && !window.__sentSWMeta) window.__sentSWMeta = {};
    if (filename && mimetype && !window.__sentSWMeta[fileId]) {
      postMessage({ fileId, filename, mimetype });
      window.__sentSWMeta[fileId] = true;
    }
    postMessage({ fileId, chunk });
  }

  function isDownloading(fileId) {
    return downloadingFiles.has(fileId);
  }

  const handleDeleteFile = (fileId) => {
    const newFiles = files.filter(f => f.fileId !== fileId);
    setFiles(newFiles);
    filesRef.current = newFiles;
    if (driveCode) {
      const filesMeta = newFiles.map(({ name, size, type, fileId }) => ({ name, size, type, fileId }));
      socket.emit('file-list', { room: driveCode, filesMeta });
    }
  };

  // --- UI ---
  if (step === 'init') {
    return (
      <div className="container">
        <h2>Send Files (noUSB style)</h2>
        <DropzoneArea onDrop={handleDrop} text="Drag and drop files here, or click to select files" />
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
        <QRCodeBlock receiverUrl={receiverUrl} driveCode={driveCode} />
        <DriveLinkBlock receiverUrl={receiverUrl} />
        <div style={{ marginTop: 20 }}>
          <DropzoneArea onDrop={handleDrop} text="Drag and drop more files here, or click to select" />
          <FileList files={files} onDelete={handleDeleteFile} isSender={true} />
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
        <FileList files={receiverFilesMeta} onDownload={handleDownloadRequest} isSender={false} isDownloading={isDownloading} />
        <ErrorBanner error={error} />
        <button onClick={() => window.location.reload()}>Enter New Drive Code</button>
      </div>
    );
  }

  useEffect(() => {
    if (step === 'receiver' && driveCode) {
      setStep('receiver');
    }
  }, [step, driveCode]);

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