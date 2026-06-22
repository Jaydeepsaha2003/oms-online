import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

const PIN_KEY = 'oms:sidebar-pinned';

/**
 * Authenticated layout. The desktop sidebar is a collapsed icon rail by default
 * and **expands on hover** as an overlay (so page content never shifts). The
 * topbar button "pins" it open — then it stays expanded and reserves its width.
 */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(PIN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  useEffect(() => {
    try {
      localStorage.setItem(PIN_KEY, pinned ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [pinned]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar: the <aside> only reserves the rail/pinned width; the panel
          itself is a fixed overlay that grows on hover without pushing content. */}
      <aside
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 md:block',
          pinned ? 'w-64' : 'w-16',
        )}
      >
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={cn(
            'fixed top-0 left-0 z-40 h-screen border-r bg-sidebar transition-[width] duration-200',
            expanded ? 'w-64' : 'w-16',
            hovered && !pinned && 'shadow-2xl shadow-blue-950/25',
          )}
        >
          <Sidebar collapsed={!expanded} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-0 h-full w-64 border-r shadow-lg">
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onToggleMobile={() => setMobileOpen(true)}
          onToggleCollapse={() => setPinned((v) => !v)}
        />
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
