import { useEffect, useState } from 'react';

// Matches this app's `sm:` Tailwind breakpoint (640px) — the same cutoff used
// throughout the mobile-card/mobile-form treatments elsewhere in the app.
const MOBILE_MQ = '(max-width: 639px)';

/** True on phone-width viewports, reactive to resize/orientation change. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener('change', update);
    // Some embedded webviews (and automated/CDP-driven viewport changes) skip MQ
    // change events — a plain resize listener catches those too.
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return isMobile;
}
