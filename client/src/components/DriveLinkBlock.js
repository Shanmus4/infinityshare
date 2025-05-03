import React from 'react';

function DriveLinkBlock({ receiverUrl }) {
  return (
    <div style={{ margin: '10px 0' }}>
      <input type="text" value={receiverUrl} readOnly style={{ width: '70%' }} onFocus={e => e.target.select()} />
      <button style={{ marginLeft: 8 }} onClick={() => {navigator.clipboard.writeText(receiverUrl)}}>Copy Link</button>
      <div style={{ marginTop: 10 }}>
        <a href={receiverUrl} target="_blank" rel="noopener noreferrer">Open Drive Link</a>
      </div>
    </div>
  );
}

export default DriveLinkBlock; 