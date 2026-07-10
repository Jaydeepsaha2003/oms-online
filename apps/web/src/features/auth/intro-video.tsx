import { useCallback, useEffect, useRef, useState } from 'react';
import introVideoSrc from '@/assets/intro/intro.mp4';
import { cn } from '@/lib/utils';

/** Full-screen first-visit intro video, shown before the login form. Muted
 * autoplay (required by browsers), skippable, fades out into the login card. */
export function IntroVideo({ onFinish }: { onFinish: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishedRef = useRef(false);
  const [fading, setFading] = useState(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFading(true);
    window.setTimeout(onFinish, 300);
  }, [onFinish]);

  useEffect(() => {
    // Some browsers (mostly older Safari) don't honor the `autoPlay` attribute
    // reliably — explicitly kick off playback, and skip straight to the login
    // screen if it's rejected instead of leaving a frozen black screen.
    videoRef.current?.play().catch(finish);
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
