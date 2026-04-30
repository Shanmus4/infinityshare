import React, { useEffect, useRef } from 'react';
import QRCodeStyling from 'qr-code-styling';

const qrInstance = (url) => new QRCodeStyling({
  width: 160,
  height: 160,
  type: 'canvas',
  data: url,
  dotsOptions: {
    color: '#0C9E8A',
    type: 'rounded',
  },
  cornersSquareOptions: {
    color: '#D63B6A',
    type: 'extra-rounded',
  },
  cornersDotOptions: {
    color: '#0C9E8A',
    type: 'dot',
  },
  backgroundOptions: {
    color: '#ffffff',
  },
  qrOptions: {
    errorCorrectionLevel: 'M',
  },
});

function QRCodeBlock({ receiverUrl }) {
  const ref = useRef(null);
  const qrRef = useRef(null);

  useEffect(() => {
    if (!receiverUrl) return;
    if (!qrRef.current) {
      qrRef.current = qrInstance(receiverUrl);
      qrRef.current.append(ref.current);
    } else {
      qrRef.current.update({ data: receiverUrl });
    }
  }, [receiverUrl]);

  return <div ref={ref} style={{ lineHeight: 0 }} />;
}

export default QRCodeBlock;