import React from 'react';

function FileList({ files, onDelete, onDownload, isSender, isDownloading }) {
  if (!files || files.length === 0) {
    return <div style={{ color: '#e74c3c', fontWeight: 'bold' }}>[No files detected. Try uploading files.]</div>;
  }
  return (
    <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
      {files.map(file => (
        <li key={file.fileId} style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ flex: 1 }}>{file.name} ({file.size.toLocaleString()} bytes)</span>
          {isSender ? (
            <button style={{ marginLeft: 8 }} onClick={() => onDelete(file.fileId)}>Delete</button>
          ) : (
            <button style={{ marginLeft: 8 }} onClick={() => onDownload(file.fileId)} disabled={isDownloading && isDownloading(file.fileId)}>
              {isDownloading && isDownloading(file.fileId) ? 'Downloading…' : 'Download'}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default FileList; 