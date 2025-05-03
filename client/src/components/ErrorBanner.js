import React from 'react';

function ErrorBanner({ error }) {
  if (!error) return null;
  return <div style={{ color: '#e74c3c', fontWeight: 'bold' }}>{error}</div>;
}

export default ErrorBanner; 