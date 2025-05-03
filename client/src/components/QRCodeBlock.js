import React from 'react';
import QRCode from 'qrcode.react';

function QRCodeBlock({ receiverUrl, driveCode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <QRCode value={receiverUrl} size={200} />
      <div>Drive code: <b>{driveCode}</b></div>
      <div>Share this code, QR, or link with receivers.</div>
    </div>
  );
}

export default QRCodeBlock; 