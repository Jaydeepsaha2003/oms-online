import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { armAudioUnlock } from '@/lib/chime';
import { usePermissions } from '@/hooks/use-permissions';
import { FollowupNudge } from '@/features/crm/followup-nudge';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

const PIN_KEY = 'oms:sidebar-pinned';
/** Pinning the sidebar open is only allowed on large desktops; below this width
 *  (13" laptops, tablets) it always behaves as the hover expand/collapse rail. */
const PIN_MQ = '(min-width: 1600px)';

/**
 * Authenticated layout. The desktop sidebar is a collapsed icon rail by default
 * and **expands on hover** as an overlay (so page content never shifts). On large
 * desktops the topbar button "pins" it open — then it stays expanded and reserves
 * its width. On smaller screens the pin is ignored so the rail never squeezes
 * the page.
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
  const [canPin, setCanPin] = useState(() => window.matchMedia(PIN_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(PIN_MQ);
    const update = () => setCanPin(mq.matches);
    mq.addEventListener('change', update);
    window.addEventListener('resize', update); // fallback — some embedded webviews skip MQ change events
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  const [hovered, setHovered] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { can } = usePermissions();

  // Unlock the reminder chime on the first interaction (autoplay policy).
  useEffect(() => armAudioUnlock(), []);
  const canViewCrm = can('crm:view');
  const isPinned = pinned && canPin;
  const expanded = isPinned || hovered;

  // Self-healing hover: mouseleave can be missed (fast exits, popovers opening,
  // alt-tab, scroll under the pointer), leaving the panel stuck open. While
  // expanded-by-hover, watch global pointer moves and collapse the moment the
  // pointer is actually outside the panel; also collapse when the window blurs.
  useEffect(() => {
    if (!hovered) return;
    const onMove = (e: PointerEvent) => {
      const el = panelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        setHovered(false);
      }
    };
    const onBlur = () => setHovered(false);
    document.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onBlur);
    };
  }, [hovered]);

  useEffect(() => {
    try {
      localStorage.setItem(PIN_KEY, pinned ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [pinned]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar: the <aside> only reserves the rail/pinned width; the panel
          itself is a fixed overlay that grows on hover without pushing content. */}
      <aside
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 md:block',
          isPinned ? 'w-64' : 'w-16',
        )}
      >
        <div
          ref={panelRef}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          className={cn(
            'fixed top-0 left-0 z-40 h-screen border-r bg-sidebar transition-[width] duration-200',
            expanded ? 'w-64' : 'w-16',
            hovered && !isPinned && 'shadow-2xl shadow-blue-950/25',
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar
          onToggleMobile={() => setMobileOpen(true)}
          onToggleCollapse={() => setPinned((v) => !v)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>

      {/* Global "anti-forget" reminder — only for users who can see CRM. */}
      {canViewCrm && <FollowupNudge />}
    </div>
  );
}
