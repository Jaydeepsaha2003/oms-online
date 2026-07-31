import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { filterMenu, menuShortcuts } from '@oms/shared';
import { usePermissions } from './use-permissions';

/**
 * Global Alt+Shift+<letter> menu navigation. Each top-level menu entry declares a
 * `shortcut` letter (see @oms/shared MENU); pressing Alt+Shift+that letter jumps to
 * the section (a group goes to its first accessible child). Bound once from the app
 * shell. Returns the active shortcut list so the sidebar can show the hints.
 *
 * We key off `event.code` ("KeyO") rather than `event.key`, so the physical letter
 * is matched regardless of how Alt/Shift mangle the produced character across layouts.
 */
export function useMenuShortcuts() {
  const navigate = useNavigate();
  const { permissions } = usePermissions();
  const shortcuts = useMemo(() => menuShortcuts(filterMenu(permissions)), [permissions]);

  useEffect(() => {
    const byKey = new Map(shortcuts.map((s) => [s.key, s.to]));
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      const m = /^Key([A-Z])$/.exec(e.code);
      if (!m) return;
      const to = byKey.get(m[1]);
      if (!to) return;
      e.preventDefault();
      navigate(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts, navigate]);

  return shortcuts;
}
