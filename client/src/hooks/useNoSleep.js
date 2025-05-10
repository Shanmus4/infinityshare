import { useEffect, useRef, useCallback, useState } from 'react';
import NoSleep from 'nosleep.js';

export function useNoSleep() {
  const noSleepRef = useRef(null);
  const [isNoSleepEnabledByApp, setIsNoSleepEnabledByApp] = useState(false); // Tracks if app has called enable

  // Initialize NoSleep instance
  useEffect(() => {
    noSleepRef.current = new NoSleep();
    // console.log('useNoSleep: NoSleep instance created.');

    // Cleanup: ensure NoSleep is disabled when the component unmounts if it was enabled by the app
    return () => {
      if (noSleepRef.current && isNoSleepEnabledByApp) {
        // console.log('useNoSleep: Disabling NoSleep.js on hook unmount because app had enabled it.');
        noSleepRef.current.disable();
        setIsNoSleepEnabledByApp(false); // Reset app's intent
      } else if (noSleepRef.current) {
        // console.log('useNoSleep: Hook unmounting, NoSleep was not actively enabled by app or already disabled.');
      }
    };
  }, [isNoSleepEnabledByApp]); // Re-run cleanup if isNoSleepEnabledByApp changes (though primarily for unmount)

  const enableNoSleep = useCallback(() => {
    if (noSleepRef.current && !noSleepRef.current.isEnabled) {
      // console.log('useNoSleep: enableNoSleep called. Attempting to enable.');
      noSleepRef.current.enable()
        .then(() => {
          setIsNoSleepEnabledByApp(true);
          console.log('NoSleep.js enabled successfully by app.');
        })
        .catch(err => {
          console.error('Failed to enable NoSleep.js:', err);
          setIsNoSleepEnabledByApp(false);
        });
    } else if (noSleepRef.current && noSleepRef.current.isEnabled) {
      // console.log('useNoSleep: enableNoSleep called, but NoSleep.js reports it is already enabled.');
      setIsNoSleepEnabledByApp(true); // Sync app state if library says it's enabled
    } else if (!noSleepRef.current) {
      console.warn('useNoSleep: NoSleep instance not available to enable.');
    }
  }, []); // No dependencies, this function is stable

  const disableNoSleep = useCallback(() => {
    // This function is less critical if we always enable on mount and disable on unmount,
    // but good to have for explicit control if ever needed.
    if (noSleepRef.current && noSleepRef.current.isEnabled) {
      // console.log('useNoSleep: disableNoSleep called. Disabling.');
      noSleepRef.current.disable();
      setIsNoSleepEnabledByApp(false);
      console.log('NoSleep.js disabled by app.');
    } else {
      // console.log('useNoSleep: disableNoSleep called, but NoSleep.js not active or no instance.');
      setIsNoSleepEnabledByApp(false); // Ensure app state reflects disabled
    }
  }, []); // No dependencies, this function is stable

  // Optional: Handle document visibility changes to re-enable if necessary
  // This is more robust if the browser itself might pause the video element used by NoSleep.js
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isNoSleepEnabledByApp && noSleepRef.current && !noSleepRef.current.isEnabled) {
        // console.log('useNoSleep: Document became visible, re-enabling NoSleep.js as app intended it to be active.');
        noSleepRef.current.enable().catch(err => console.error('Failed to re-enable NoSleep.js on visibility change:', err));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isNoSleepEnabledByApp]); // Depends on whether the app wants it enabled

  // We don't return isNoSleepActive from the library directly, as it might be complex.
  // The app cares more about whether it *tried* to enable it.
  return { enableNoSleep, disableNoSleep };
}
