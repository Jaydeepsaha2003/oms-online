import { useCallback, useEffect, useRef, useState } from 'react';
import introVideoSrc from '@/assets/intro/intro.mp4';
import { cn } from '@/lib/utils';

/** Full-screen first-visit intro video, shown before the login form. Muted
 * autoplay (required by browsers), skippable, fades out into the login card.
 * If the video can't start quickly — iOS Low Power Mode silently blocks
 * autoplay, or the 2 MB file is still buffering over a phone's Wi-Fi — we skip
 * straight to the login screen instead of trapping the user on a black one. */
export function IntroVideo({ onFinish }: { onFinish: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishedRef = useRef(false);
  const stuckTimerRef = useRef<number | undefined>(undefined);
  const [fading, setFading] = useState(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    window.clearTimeout(stuckTimerRef.current);
    setFading(true);
    window.setTimeout(onFinish, 300);
  }, [onFinish]);

  // Once the video actually reaches the "playing" state, cancel the safety
  // timer below so a normally-playing intro runs through to the end.
  const handlePlaying = useCallback(() => {
    window.clearTimeout(stuckTimerRef.current);
  }, []);

  useEffect(() => {
    // Some browsers (mostly older Safari) don't honor the `autoPlay` attribute
    // reliably — explicitly kick off playback, and skip straight to the login
    // screen if it's rejected instead of leaving a frozen black screen.
    videoRef.current?.play().catch(finish);

    // Safety net for the cases play()'s promise never settles: on iOS a
    // still-buffering or Low-Power-Mode-blocked video leaves us on the black
    // container with neither onError nor onEnded ever firing. If it hasn't
    // started playing within this window, jump to the login form. onPlaying
    // clears this, so a video that does start is never cut off early.
    stuckTimerRef.current = window.setTimeout(finish, 2000);
    return () => window.clearTimeout(stuckTimerRef.current);
  }, [finish]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-300',
        fading ? 'opacity-0' : 'opacity-100',
      )}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        src={introVideoSrc}
        autoPlay
        muted
        playsInline
        onPlaying={handlePlaying}
        onEnded={finish}
        onError={finish}
      />
      <button
        type="button"
        onClick={finish}
        className="absolute right-4 top-4 rounded-full bg-black/40 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-black/60"
      >
        Skip
      </button>
    </div>
  );
}
