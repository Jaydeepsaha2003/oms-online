/**
 * Reminder chime + haptics.
 *
 * The chime is a LOUD, attention-grabbing multi-tone WebAudio melody (no audio
 * asset needed). It is designed to be clearly audible even at a distance —
 * perfect for urgent follow-up reminders.
 *
 * Browsers block audio that isn't tied to a user gesture, and our reminders
 * fire from a background poll — so the AudioContext would start `suspended` and
 * stay silent. `armAudioUnlock()` resumes it on the first user interaction
 * (which always happens — the user clicks to log in), after which timer-driven
 * chimes play.
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Play a single tone at a given frequency and volume for a given duration. */
function tone(
  c: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  // Quick attack, sustain, then release
  const attack = Math.min(0.015, duration * 0.15);
  const release = Math.min(0.08, duration * 0.3);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + attack);
  gain.gain.setValueAtTime(volume, startAt + duration - release);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain).connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.01);
}

// ── Main chime ───────────────────────────────────────────────────────────────

/**
 * A LOUD, urgent, attention-grabbing notification chime.
 *
 * Structure (≈ 1.8 seconds total):
 *   Phase 1 — Rapid trill:  3 quick high pings to grab attention
 *   Phase 2 — Rising chord: rich ascending notes (feels like "wake up!")
 *   Phase 3 — Alert pings:  2 final insistent pings that say "ACT NOW"
 *
 * The overall volume is set high (0.7) so it's clearly audible.
 */
export function playChime(): void {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});

  try {
    const now = c.currentTime;
    const LOUD = 0.7; // Main volume — much louder than before (was 0.18)
    const MED = 0.5;

    // ── Phase 1: Rapid attention trill (3 quick pings) ─────────────────────
    const trillNotes = [1320, 1568, 1760]; // E6, G6, A6
    trillNotes.forEach((freq, i) => {
      tone(c, freq, now + i * 0.09, 0.1, LOUD, 'sine');
      // Add a triangle harmonic layer for richness
      tone(c, freq * 0.5, now + i * 0.09, 0.1, MED * 0.3, 'triangle');
    });

    // ── Phase 2: Bold rising chord (the "important!" moment) ───────────────
    const chordStart = now + 0.35;
    const chordNotes = [
      { freq: 880, delay: 0, dur: 0.35 },    // A5
      { freq: 1108, delay: 0.08, dur: 0.30 }, // C#6
      { freq: 1320, delay: 0.16, dur: 0.28 }, // E6
      { freq: 1760, delay: 0.22, dur: 0.35 }, // A6 — top note rings longer
    ];
    chordNotes.forEach(({ freq, delay, dur }) => {
      tone(c, freq, chordStart + delay, dur, LOUD * 0.85, 'sine');
      // Warm sub-layer
      tone(c, freq * 0.5, chordStart + delay, dur * 0.8, MED * 0.25, 'triangle');
    });

    // ── Phase 3: Final urgent pings ("ACT NOW!") ───────────────────────────
    const pingStart = now + 1.05;
    [1760, 2093].forEach((freq, i) => { // A6, C7
      const t = pingStart + i * 0.2;
      tone(c, freq, t, 0.18, LOUD, 'sine');
      tone(c, freq, t, 0.18, MED * 0.4, 'square'); // Adds an edgy urgency
    });

    // ── Bonus: second repeat after a brief pause for extra urgency ─────────
    const repeatStart = now + 1.65;
    [1760, 2093, 2349].forEach((freq, i) => { // A6, C7, D7
      tone(c, freq, repeatStart + i * 0.12, 0.14, LOUD * 0.75, 'sine');
    });
  } catch {
    /* audio unavailable — ignore */
  }
}

/** Best-effort haptic buzz on devices that support the Vibration API. */
export function buzz(pattern: number | number[] = [80, 50, 80, 50, 120]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
