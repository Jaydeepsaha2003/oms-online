import { useState } from 'react';
import { Bell } from 'lucide-react';
import { DashboardFollowups } from '@/features/crm/dashboard-followups';
import { AnalyticsSection } from './analytics-section';

const HIDE_KEY = 'oms:notif-panel-hidden';

export function DashboardPage() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = (v: boolean) => {
    setHidden(v);
    try {
      localStorage.setItem(HIDE_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  return (
    // At lg the row itself is the scroll container and stretches to the content-area
    // edges (its vertical scrollbar therefore sits at the far right, just after the
    // docked Notifications panel). The left padding of `main` is kept.
    <div className="flex h-full flex-col gap-6 lg:-my-6 lg:h-[calc(100%+3rem)] lg:w-[calc(100%+1.5rem)] lg:items-start lg:gap-0 lg:overflow-y-auto lg:flex-row">
      {/* Main column — analytics KPIs + order-vs-challan chart. */}
      <div className="min-w-0 flex-1 lg:py-6 lg:pr-6">
        <AnalyticsSection />
      </div>

      {/* Notifications — a normal card on small screens; on desktop it docks flush to
          the top, right and bottom edges as a sticky full-height rail. */}
      {!hidden && (
        <aside className="shrink-0 lg:sticky lg:top-0 lg:h-full lg:w-[340px]">
          <DashboardFollowups docked onHide={() => toggle(true)} />
        </aside>
      )}

      {/* When hidden: a slim tab to bring it back (notifications also live on the bell). */}
      {hidden && (
        <button
          type="button"
          onClick={() => toggle(false)}
          className="bg-card hover:bg-accent fixed right-0 top-24 z-20 flex items-center gap-1 rounded-l-lg border border-r-0 px-1.5 py-3 text-xs font-medium text-amber-700 shadow-sm [writing-mode:vertical-rl]"
          aria-label="Show notifications panel"
        >
          <Bell className="size-4 rotate-180" />
          Notifications
        </button>
      )}
    </div>
  );
}
