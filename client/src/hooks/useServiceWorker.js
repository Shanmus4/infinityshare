import { useEffect } from 'react';

export function useServiceWorker(onMessage) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js');
    }
  }, []);

  useEffect(() => {
    if (!onMessage) return;
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [onMessage]);

  // Helper to post message to SW
  function postMessage(msg) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(msg);
    }
  }

  return { postMessage };
} 