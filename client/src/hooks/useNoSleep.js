import { useEffect, useRef, useCallback, useState } from 'react';
import NoSleep from 'nosleep.js';

export function useNoSleep() {
  const noSleepRef = useRef(null);
  // Tracks if the app has successfully called .enable() on the instance
  const [isNoSleepActiveByApp, setIsNoSleepActiveByApp] = useState(false);

  useEffect(() => {
    // Initialize NoSleep instance on mount
    noSleepRef.current = new NoSleep();
    // console.log('useNoSleep: NoSleep instance created.');

    // Cleanup: ensure NoSleep is disabled when the component unmounts
    // if it was active or the app intended it to be.
    return () => {
      if (noSleepRef.current && noSleepRef.current.isEnabled) {
        // console.log('useNoSleep: Disabling NoSleep.js on hook unmount.');
        noSleepRef.current.disable();
      }
      noSleepRef.current = null; // Clean up the instance itself
      setIsNoSleepActiveByApp(false);
    };
  }, []); // Runs once on mount and cleanup on unmount

  const enableNoSleep = useCallback(() => {
    if (noSleepRef.current && !noSleepRef.current.isEnabled) {
      // console.log('useNoSleep: Attempting to enable NoSleep.js...');
      noSleepRef.current.enable()
        .then(() => {
          setIsNoSleepActiveByApp(true);
          console.log('NoSleep.js enabled successfully.');
        })
        .catch(err => {
          console.error('Failed to enable NoSleep.js:', err);
          setIsNoSleepActiveByApp(false); // Ensure state reflects failure
        });
    } else if (noSleepRef.current && noSleepRef.current.isEnabled) {
      // console.log('useNoSleep: NoSleep.js is already enabled.');
      setIsNoSleepActiveByApp(true); // Sync state
    }
  }, []);

  const disableNoSleep = useCallback(() => {
    if (noSleepRef.current && noSleepRef.current.isEnabled) {
      // console.log('useNoSleep: Attempting to disable NoSleep.js...');
      noSleepRef.current.disable();
      setIsNoSleepActiveByApp(false);
      console.log('NoSleep.js disabled.');
    }
  }, []);

  // Handle document visibility changes to re-enable if necessary
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isNoSleepActiveByApp && noSleepRef.current && !noSleepRef.current.isEnabled) {
        // console.log('useNoSleep: Document became visible, re-enabling NoSleep.js.');
        // NoSleep.js handles the user interaction requirement internally for re-enabling.
        noSleepRef.current.enable().catch(err => console.error('Failed to re-enable NoSleep.js on visibility change:', err));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isNoSleepActiveByApp]); // Re-evaluate if app's intent/state changes

  return { enableNoSleep, disableNoSleep, isEnabled: isNoSleepActiveByApp };
}
