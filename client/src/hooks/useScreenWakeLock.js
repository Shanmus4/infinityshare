import { useState, useEffect, useCallback, useRef } from 'react';

const useScreenWakeLock = () => {
  const [isSupported, setIsSupported] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const wakeLockSentinelRef = useRef(null);

  useEffect(() => {
    if ('wakeLock' in navigator) {
      setIsSupported(true);
    } else {
      console.warn('Screen Wake Lock API not supported.');
      setIsSupported(false);
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!isSupported || wakeLockSentinelRef.current) {
      // Not supported or lock already active
      if (wakeLockSentinelRef.current) setIsActive(true); // Ensure isActive reflects reality
      return;
    }
    try {
      wakeLockSentinelRef.current = await navigator.wakeLock.request('screen');
      setIsActive(true);
      console.log('Screen Wake Lock requested and acquired.');

      wakeLockSentinelRef.current.addEventListener('release', () => {
        console.log('Screen Wake Lock was released.');
        setIsActive(false);
        // wakeLockSentinelRef.current should be null here as per spec,
        // but good practice to clear our ref too if it wasn't auto-cleared by event.
        // However, we might want to re-acquire it if the page is still visible.
        // This is handled by visibilitychange listener.
      });
    } catch (err) {
      console.error(`Screen Wake Lock request failed: ${err.name}, ${err.message}`);
      setIsActive(false);
      wakeLockSentinelRef.current = null;
    }
  }, [isSupported]);

  const releaseWakeLock = useCallback(async () => {
    if (!isSupported || !wakeLockSentinelRef.current) {
      // Not supported or no lock to release
      setIsActive(false); // Ensure isActive reflects reality
      return;
    }
    try {
      await wakeLockSentinelRef.current.release();
      wakeLockSentinelRef.current = null;
      setIsActive(false); // Explicitly set after successful release
      console.log('Screen Wake Lock released by application.');
    } catch (err) {
      console.error(`Screen Wake Lock release failed: ${err.name}, ${err.message}`);
      // isActive might still be true if release failed, or false if it was released by OS.
      // The 'release' event on the sentinel should update isActive correctly.
    }
  }, [isSupported]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isSupported || !wakeLockSentinelRef.current) return; // Only if supported and we thought we had a lock
      
      if (document.visibilityState === 'visible') {
        // Tab became visible, try to re-acquire the lock if it was released
        // This check is important because the 'release' event on the sentinel
        // should have set wakeLockSentinelRef.current to null if it was OS-released.
        // If we still have a sentinel, it means our app released it, or it's still active.
        // For safety, or if we want to ensure it's active on visibility, re-request.
        // However, a simpler model is to only re-request if our app *wants* it active
        // and it's currently not (e.g. isActive is false but should be true).
        // The App.js logic will handle calling requestWakeLock if conditions are met.
        // This listener is more for logging or specific re-acquisition strategies if needed.
        console.log('Document became visible. Wake lock status:', isActive ? 'active' : 'inactive');
        // If you want to auto-reacquire when tab becomes visible AND the app logic still wants it:
        // if (shouldBeActive && !isActive) requestWakeLock();
        // For now, let App.js manage the request based on its state.
      } else {
        // Tab became hidden, lock will be released by the browser.
        // The 'release' event on the sentinel will handle updating isActive.
        console.log('Document became hidden. Screen Wake Lock will be released by the browser.');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Also listen for fullscreenchange as it can affect wake locks
    document.addEventListener('fullscreenchange', handleVisibilityChange);


    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleVisibilityChange);
      // Ensure lock is released on component unmount if still active
      if (wakeLockSentinelRef.current) {
        // Use a separate async function for cleanup because useEffect cleanup cannot be async
        const cleanupLock = async () => {
          try {
            await wakeLockSentinelRef.current.release();
            console.log('Screen Wake Lock released on hook unmount.');
          } catch(e) { /* ignore error on unmount release */ }
          wakeLockSentinelRef.current = null;
          setIsActive(false);
        };
        cleanupLock();
      }
    };
  }, [isSupported, isActive]); // Added isActive to re-run if it changes externally

  return { requestWakeLock, releaseWakeLock, isWakeLockActive: isActive, isWakeLockSupported: isSupported };
};

export default useScreenWakeLock;
