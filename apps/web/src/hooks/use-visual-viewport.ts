import { useEffect, useState } from 'react';

export interface ViewportInsets {
  /** Height of the actually-visible viewport in px — shrinks when the mobile
   *  on-screen keyboard opens (unlike `window.innerHeight` / `100vh`, which don't). */
  height: number;
  /** Distance from the top of the full layout viewport to the top of the visible one. */
  offsetTop: number;
}

const fallback = (): ViewportInsets => ({
  height: window.innerHeight,
  offsetTop: 0,
});

/**
 * Tracks `window.visualViewport` (falls back to `window.innerHeight` where
 * unsupported — identical to today's behavior, so no regression). Fixed-position
 * panels (dialogs, bottom sheets) sized or centered off `100vh`/`innerHeight`
 * don't react when a mobile keyboard opens, since those units don't shrink —
 * only the visual viewport does. Components read this hook to stay within the
 * space that's actually visible above the keyboard.
 */
export function useVisualViewportInsets(): ViewportInsets {
  const [insets, setInsets] = useState<ViewportInsets>(fallback);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInsets({ height: vv.height, offsetTop: vv.offsetTop });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return insets;
}

/** Scrolls a just-focused input/textarea/select into view once the keyboard's
 *  open animation (and the resulting viewport resize) has settled. Attach to a
 *  dialog/sheet's `onFocusCapture` so a field deep in a scrollable form is
 *  guaranteed visible, even beyond what repositioning the panel alone covers. */
export function scrollFocusedFieldIntoView(e: React.FocusEvent) {
  const el = e.target as HTMLElement;
  if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
}
