/**
 * Reminder chime + haptics.
 *
 * The chime is a short two-tone WebAudio beep (no audio asset needed). Browsers
 * block audio that isn't tied to a user gesture, and our reminders fire from a
 * background poll — so the AudioContext would start `suspended` and stay silent.
 * `armAudioUnlock()` resumes it on the first user interaction (which always
 * happens — the user clicks to log in), after which timer-driven chimes play.
 */

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Resume the audio context on the first user gesture. Safe to call repeatedly. */
export function armAudioUnlock(): void {
  const unlock = () => {
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
}

/** A short rising two-tone chime. */
export function playChime(): void {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try {
    const now = c.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  } catch {
    /* audio unavailable — ignore */
  }
}

/** Best-effort haptic buzz on devices that support the Vibration API. */
export function buzz(pattern: number | number[] = [40, 30, 40]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
