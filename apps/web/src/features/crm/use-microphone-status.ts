import { useEffect, useState } from 'react';

/**
 * Only reports what is knowable before permission is granted: whether the page
 * is a secure context with getUserMedia available. Deliberately does NOT probe
 * enumerateDevices() — Safari hides devices until access is granted, so a
 * pre-permission "no microphone" result is unreliable and must not gate the UI.
 * Actual mic presence is discovered when getUserMedia runs.
 */
export function useMicrophoneStatus() {
  const [isSecure, setIsSecure] = useState(true);

  useEffect(() => {
    setIsSecure(window.isSecureContext !== false && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  return { isSecure };
}
