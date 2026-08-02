import { useEffect, useRef } from 'react';

/**
 * Ctrl/Cmd+S triggers `onSave` from anywhere on the page (inputs included),
 * overriding the browser's Save-page dialog. Always calls the LATEST `onSave`
 * via a ref, so callers don't need to memoize it. Pass `enabled: false` to
 * suspend the shortcut without unmounting the hook — e.g. a dialog's save
 * handler should only fire while that dialog is actually open.
 */
export function useSaveShortcut(onSave: () => void, enabled = true) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
