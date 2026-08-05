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
  const capTimerRef = useRef<number | undefined>(undefined);
  const [fading, setFading] = useState(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    window.clearTimeout(stuckTimerRef.current);
    window.clearTimeout(capTimerRef.current);
    setFading(true);
    window.setTimeout(onFinish, 300);
  }, [onFinish]);

  // Once the video actually reaches the "playing" state, cancel both safety
  // timers below so a normally-playing intro runs through to the end.
  const handlePlaying = useCallback(() => {
    window.clearTimeout(stuckTimerRef.current);
    window.clearTimeout(capTimerRef.current);
  }, []);

  /**
   * The video is alive — metadata parsed, or bytes arriving.
   *
   * This is what separates "blocked" from "merely slow", and the original flat
   * deadline could not tell them apart: it gave the video 2s from mount to
   * reach `playing` or be skipped. This file is 2.3 MB, so on a phone over the
   * VPN that deadline is missed routinely and the intro silently never plays —
   * the failure looks identical to the video being broken. Any sign of progress
   * now hands over to the longer cap, which still guarantees nobody is ever
   * trapped on a black screen.
   */
  const handleProgress = useCallback(() => {
    window.clearTimeout(stuckTimerRef.current);
  }, []);

  useEffect(() => {
    // Some browsers (mostly older Safari) don't honor the `autoPlay` attribute
    // reliably — explicitly kick off playback, and skip straight to the login
    // screen if it's rejected instead of leaving a frozen black screen.
    videoRef.current?.play().catch(finish);

    // Stage 1 — nothing at all has happened: no metadata, not a single byte.
    // That's the genuinely stuck case the original timer was written for (iOS
    // Low Power Mode silently refusing to start), and it stays short.
    stuckTimerRef.current = window.setTimeout(finish, 2000);
    // Stage 2 — a hard ceiling, so "slow" can never become "hangs forever" no
    // matter what stage 1 saw. Kept short deliberately: this is time spent
    // looking at a black screen, and the file is fast-start (its moov sits in
    // the first 14 KB), so playback begins on the first chunks rather than
    // needing all 2.3 MB. A link that can't manage that in six seconds is
    // better served by going straight to the login form.
    capTimerRef.current = window.setTimeout(finish, 6_000);
    return () => {
      window.clearTimeout(stuckTimerRef.current);
      window.clearTimeout(capTimerRef.current);
    };
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
        preload="auto"
        onPlaying={handlePlaying}
        onLoadedMetadata={handleProgress}
        onLoadedData={handleProgress}
        onProgress={handleProgress}
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
