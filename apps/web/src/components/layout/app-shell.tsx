import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

/** Authenticated layout: collapsible desktop sidebar, mobile drawer, topbar, content. */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 border-r transition-[width] duration-200 md:block',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div className="sticky top-0 h-screen">
          <Sidebar collapsed={collapsed} />
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
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
