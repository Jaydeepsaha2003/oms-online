import { useEffect, useState } from 'react';

export function useMicrophoneStatus() {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [hasMic, setHasMic] = useState<boolean | null>(null);
  const [isSecure, setIsSecure] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const secure = window.isSecureContext !== false;
    setIsSecure(secure);

    const supported = !!(navigator.mediaDevices?.getUserMedia);
    setIsSupported(supported);

    if (!supported) {
      setHasMic(false);
      return;
    }

    const checkDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const micExists = devices.some((d) => d.kind === 'audioinput');
        setHasMic(micExists);
      } catch {
        setHasMic(false);
      }
    };

    checkDevices();

    // Listen for device changes (e.g. plugging/unplugging a mic)
    navigator.mediaDevices.addEventListener('devicechange', checkDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', checkDevices);
    };
  }, []);

  return {
    isSupported,
    hasMic,
    isSecure,
    canRecord: isSupported !== false && hasMic !== false && isSecure,
  };
}
