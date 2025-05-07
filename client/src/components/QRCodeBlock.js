import React from 'react';
import QRCode from 'qrcode.react';

// Modified to only render the QR code itself
function QRCodeBlock({ receiverUrl }) {
  // Removed driveCode prop as it's displayed separately now
  // Removed wrapper div and extra text
  return (
      <QRCode value={receiverUrl} size={160} /> // Set size to 160
  );
}

export default QRCodeBlock; 