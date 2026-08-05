/**
 * Is the primary pointer a finger?
 *
 * The honest test for "there is an on-screen keyboard, and the screen is a
 * phone or tablet" — better than a width breakpoint, which also catches a
 * narrow desktop window. A laptop with a touchscreen still reports `fine` as
 * its primary pointer, so it counts as desktop.
 */
export function isTouchPrimary(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches === true;
}
