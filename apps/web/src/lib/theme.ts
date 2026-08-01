import { useEffect, useReducer } from 'react';

/**
 * App theme: light, dark, or follow the OS ("system"). The choice is stored per
 * browser and applied by toggling a `.dark` class on <html> — every semantic
 * colour token (bg-card, text-foreground, border-border, …) then flips via the
 * CSS variables in index.css. The dark palette is a deep navy, not black.
 *
 * An inline script in index.html applies the saved theme before this bundle runs,
 * so there's no light-to-dark flash on load; this module keeps them in sync.
 */
export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'oms:theme';

function readStored(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Does the given preference resolve to a dark appearance right now? */
export function isDark(pref: ThemePref): boolean {
  return pref === 'dark' || (pref === 'system' && systemPrefersDark());
}

let current = readStored();
const listeners = new Set<() => void>();

/** Add/remove `.dark` on <html> to match the resolved preference. */
function apply(pref: ThemePref): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', isDark(pref));
}

export function getTheme(): ThemePref {
  return current;
}

export function setTheme(pref: ThemePref): void {
  current = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* private mode / quota — the theme just won't persist */
  }
  apply(pref);
  listeners.forEach((l) => l());
}

// Apply the stored choice as soon as this module loads (main.tsx imports it before
// the first render), and keep "system" live if the OS theme changes mid-session.
apply(current);
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current === 'system') {
      apply('system');
      listeners.forEach((l) => l());
    }
  });
}

/**
 * Subscribe a component to the theme. Returns the stored preference, whether it
 * currently resolves to dark, and a setter. Re-renders on any change (including
 * an OS switch while on "system").
 */
export function useTheme() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return { theme: current, dark: isDark(current), setTheme };
}
