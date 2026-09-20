import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The phone skin the Reports and CRM mockups share: a living liquid wallpaper
 * with frosted glass floating on it.
 *
 * The rules live in the `.rp-*` block in index.css, all of it inside one phone
 * media query — so these components can be rendered unconditionally and simply
 * have no effect above `sm`, where each page keeps its desktop layout. What is
 * here is only the markup those rules need.
 */

/** The mockups' tone palette — one entry per colour, with its tint, ink,
 *  hairline and gradient. Shared so a "rose" chip on the payment desk is the
 *  same rose as a "rose" rail on the follow-up board. */
export type SkinTone = 'rose' | 'amber' | 'sky' | 'violet' | 'emerald' | 'slate' | 'indigo' | 'blue';
export const SKIN_TONE: Record<SkinTone, { bg: string; fg: string; ring: string; solid: string; grad: string }> = {
  rose: { bg: 'rgba(255,228,230,.78)', fg: '#9f1239', ring: 'rgba(244,63,94,.34)', solid: '#f43f5e', grad: 'linear-gradient(150deg,#fb7185,#be123c)' },
  amber: { bg: 'rgba(254,243,199,.8)', fg: '#92400e', ring: 'rgba(245,158,11,.36)', solid: '#f59e0b', grad: 'linear-gradient(150deg,#fbbf24,#b45309)' },
  sky: { bg: 'rgba(224,242,254,.8)', fg: '#075985', ring: 'rgba(14,165,233,.34)', solid: '#0ea5e9', grad: 'linear-gradient(150deg,#38bdf8,#0369a1)' },
  violet: { bg: 'rgba(237,233,254,.8)', fg: '#5b21b6', ring: 'rgba(139,92,246,.34)', solid: '#8b5cf6', grad: 'linear-gradient(150deg,#a78bfa,#6d28d9)' },
  emerald: { bg: 'rgba(209,250,229,.78)', fg: '#065f46', ring: 'rgba(16,185,129,.34)', solid: '#10b981', grad: 'linear-gradient(150deg,#34d399,#047857)' },
  slate: { bg: 'rgba(226,232,240,.8)', fg: '#334155', ring: 'rgba(100,116,139,.3)', solid: '#94a3b8', grad: 'linear-gradient(150deg,#94a3b8,#334155)' },
  indigo: { bg: 'rgba(224,231,255,.8)', fg: '#3730a3', ring: 'rgba(99,102,241,.32)', solid: '#6366f1', grad: 'linear-gradient(150deg,#818cf8,#4338ca)' },
  blue: { bg: 'rgba(219,234,254,.8)', fg: '#1e40af', ring: 'rgba(59,130,246,.34)', solid: '#3b82f6', grad: 'linear-gradient(150deg,#60a5fa,#1e40af)' },
};

/** A tinted surface in a tone — chips, pills, avatars. */
export const toneSurface = (tone: SkinTone): CSSProperties => ({
  background: SKIN_TONE[tone].bg,
  color: SKIN_TONE[tone].fg,
  boxShadow: `inset 0 0 0 1px ${SKIN_TONE[tone].ring}, inset 0 1px 0 rgba(255,255,255,.7)`,
});
/** Stagger helper — every list in the mockups enters one item at a time. */
export const skinDelay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * The living wallpaper: a soft vertical plate with three tinted blobs drifting
 * across it on their own clocks. Fixed, so it stays still while the page
 * scrolls over it, and behind the page's content layer (see `.rp-wallpaper`).
 *
 * One per page — whichever component owns the header renders it.
 */
export function MobileWallpaper() {
  return (
    <div aria-hidden className="rp-wallpaper sm:hidden">
      <span className="rp-blob rp-blob-1" />
      <span className="rp-blob rp-blob-2" />
      <span className="rp-blob rp-blob-3" />
    </div>
  );
}

/**
 * The blue header block: a headline figure, an optional chip beside it, a hint
 * underneath, and whatever the page needs below that (tabs, chips, a search).
 *
 * It carries no page name or icon — the app's topbar already shows both, and
 * repeating them a few pixels lower is what the desktop headers dropped long
 * ago. `rounded` opens the bottom corners; pages that continue the blue with
 * their own strip beneath pass `rounded={false}`.
 */
export function MobileHero({
  label, value, chip, chipTone = 'emerald', hint, children, className,
}: {
  label: string;
  value: string;
  chip?: string;
  chipTone?: 'emerald' | 'rose';
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rp-hero sm:hidden', className)} style={{ borderRadius: '24px', padding: '14px 16px' }}>
      <span aria-hidden className="rp-hero-sheen" />
      <span aria-hidden className="rp-hero-grid" />
      <div className="relative flex items-end gap-3">
        <div className="min-w-0">
          <div className="rp-hero-label">{label}</div>
          <div className="rp-hero-value">{value}</div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1.5 pb-0.5">
          {chip && (
            <span className="rp-hero-delta" style={{ color: chipTone === 'rose' ? '#fecdd3' : '#a7f3d0' }}>{chip}</span>
          )}
          {hint && <span className="rp-hero-hint">{hint}</span>}
        </div>
      </div>
      {children && <div className="relative mt-3">{children}</div>}
    </div>
  );
}

/** The tab bar that sits on the hero's blue. */
export function MobileTabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: string; count?: number | null }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="rp-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className="rp-tab" data-on={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count != null && t.count > 0 && <span className="rp-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** One of the four tappable KPI tiles above a CRM board. Tapping it filters
 *  the board to that bucket; tapping it again clears the filter. */
export function MobileKpiTile({ label, value, tone, icon, active, onClick, i = 0 }: {
  label: string;
  value: number | string;
  tone: SkinTone;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  i?: number;
}) {
  const T = SKIN_TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rp-kpi-tile"
      style={{
        ...skinDelay(i * 50),
        ...(active ? { boxShadow: `0 16px 34px -18px ${T.ring}, inset 0 1px 0 rgba(255,255,255,.95), 0 0 0 1.5px ${T.solid}` } : null),
      }}
    >
      <span className="rp-kpi-icon" style={{ background: T.bg, color: T.fg, boxShadow: `inset 0 0 0 1px ${T.ring}, inset 0 1px 0 rgba(255,255,255,.8)` }}>
        {icon}
      </span>
      <div className="mt-2.5 rp-kpi-num" style={{ color: T.fg }}>{value}</div>
      <div className="mt-1 text-[11px] font-bold text-[#3d5273] dark:text-[#93a6c9]">{label}</div>
    </button>
  );
}

/** One card on the money rail — a figure, what it is, and a one-line note. */
export function MoneyCard({ label, value, hint, tone, i = 0 }: {
  label: string;
  value: string;
  hint?: string;
  tone: SkinTone;
  i?: number;
}) {
  const T = SKIN_TONE[tone];
  return (
    <div className="rp-money" style={skinDelay(i * 55)}>
      <span aria-hidden className="rp-glass-sheen" />
      <span className="rp-money-dot" style={{ background: T.grad, boxShadow: `0 4px 10px -4px ${T.ring}` }} />
      <div className="rp-money-value">{value}</div>
      <div className="rp-money-label">{label}</div>
      {hint && <div className="rp-money-hint">{hint}</div>}
    </div>
  );
}

/** A tone chip — the CRM boards' unit of status. */
export function SkinChip({ tone, children }: { tone: SkinTone; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-[9px] py-[3px] text-[10px] font-extrabold tracking-[0.02em] whitespace-nowrap"
      style={toneSurface(tone)}
    >
      {children}
    </span>
  );
}
