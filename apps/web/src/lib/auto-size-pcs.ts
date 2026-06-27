import { useEffect, useReducer } from 'react';

/**
 * User preference: auto-detect Size vs Pcs from what's typed in the order form's
 * Item name field. ON (default) hides the manual Size/Pcs radio and flips it
 * automatically; OFF shows the radio for manual selection. Stored per-browser.
 */
const KEY = 'oms:auto-size-pcs';

let current = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off'; // default ON
  } catch {
    return true;
  }
})();
const listeners = new Set<() => void>();

export function getAutoSizePcs(): boolean {
  return current;
}

export function setAutoSizePcs(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Subscribe a component to the preference; re-renders when it changes. */
export function useAutoSizePcs() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return { autoSizePcs: current, setAutoSizePcs };
}
