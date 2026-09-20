import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, RotateCcw } from 'lucide-react';
import type { ReportFilterOptions, ReportFilters } from '@oms/shared';
import { http } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NativeSelect } from '@/components/common/combo';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/** Distinct agents / regions / customers for the filter dropdowns. */
export function useReportFilterOptions() {
  return useQuery({
    queryKey: ['reports', 'filter-options'],
    queryFn: () => http.get<ReportFilterOptions>('/reports/filter-options'),
    staleTime: 5 * 60_000,
  });
}

export interface FilterState {
  from: string;
  to: string;
  customerId: string;
  agent: string;
  region: string;
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The default period every report opens on: the current financial year to date
 *  (India FY starts 1 April). Reset returns here, not to "all time". */
function fyDefault(): FilterState {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${y}-04-01`, to: ymd(now), customerId: '', agent: '', region: '' };
}

/** Filter state + the query object every report hook consumes. */
export function useReportFilters() {
  const def = useMemo(fyDefault, []);
  const [f, setF] = useState<FilterState>(def);
  const query: ReportFilters = useMemo(
    () => ({
      from: f.from || undefined,
      to: f.to || undefined,
      customerId: f.customerId ? Number(f.customerId) : undefined,
      agent: f.agent || undefined,
      region: f.region || undefined,
    }),
    [f],
  );
  // "Active" = narrowed beyond the FY-to-date default (so Reset is meaningful).
  const active = !!(f.customerId || f.agent || f.region) || f.from !== def.from || f.to !== def.to;
  return { f, setF, query, active, reset: () => setF(def) };
}
function presetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  switch (preset) {
    case 'This FY': {
      const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      return { from: `${y}-04-01`, to: today };
    }
    case 'Last 30 days': { const d = new Date(now); d.setDate(d.getDate() - 30); return { from: ymd(d), to: today }; }
    case 'Last 90 days': { const d = new Date(now); d.setDate(d.getDate() - 90); return { from: ymd(d), to: today }; }
    case 'This month': return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    default: return { from: '', to: '' }; // All time
  }
}
const PRESETS = ['All time', 'This FY', 'Last 90 days', 'Last 30 days', 'This month'];

/** The controls shared by the desktop bar and the mobile sheet — period preset,
 *  from/to, customer, agent, region. `stacked` lays each field full-width for
 *  the sheet instead of the bar's inline row. */
function FilterFields({ f, setF, stacked }: { f: FilterState; setF: (u: (p: FilterState) => FilterState) => void; stacked?: boolean }) {
  const { data } = useReportFilterOptions();
  const customers = data?.customers ?? [];
  const custName = f.customerId ? customers.find((c) => String(c.id) === f.customerId)?.name ?? '' : '';
  const applyPreset = (p: string) => setF((prev) => ({ ...prev, ...presetRange(p) }));

  return (
    <>
      <div className={cn('min-w-0', stacked && 'space-y-1.5')}>
        <Label className="text-muted-foreground mb-1 block text-xs">Period</Label>
        <NativeSelect value="" onChange={applyPreset} options={['', ...PRESETS]} placeholder="Quick range" className={stacked ? undefined : 'w-44'} />
      </div>
      <div className={stacked ? 'grid grid-cols-2 gap-2' : 'contents'}>
        <div>
          <Label className="text-muted-foreground mb-1 block text-xs">From</Label>
          <Input type="date" value={f.from} onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))} className={stacked ? undefined : 'w-[9.5rem]'} />
        </div>
        <div>
          <Label className="text-muted-foreground mb-1 block text-xs">To</Label>
          <Input type="date" value={f.to} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))} className={stacked ? undefined : 'w-[9.5rem]'} />
        </div>
      </div>
      <div className={cn('min-w-0', !stacked && 'flex-1 basis-52')}>
        <Label className="text-muted-foreground mb-1 block text-xs">Customer</Label>
        <NativeSelect
          value={custName}
          onChange={(name) => setF((p) => ({ ...p, customerId: name ? String(customers.find((c) => c.name === name)?.id ?? '') : '' }))}
          options={['', ...customers.map((c) => c.name)]}
          placeholder="All customers"
        />
      </div>
      <div className={cn('min-w-0', !stacked && 'basis-40')}>
        <Label className="text-muted-foreground mb-1 block text-xs">Agent</Label>
        <NativeSelect value={f.agent} onChange={(v) => setF((p) => ({ ...p, agent: v }))} options={['', ...(data?.agents ?? [])]} placeholder="All agents" />
      </div>
      <div className={cn('min-w-0', !stacked && 'basis-40')}>
        <Label className="text-muted-foreground mb-1 block text-xs">Region</Label>
        <NativeSelect value={f.region} onChange={(v) => setF((p) => ({ ...p, region: v }))} options={['', ...(data?.regions ?? [])]} placeholder="All regions" />
      </div>
    </>
  );
}

/** How many filters differ from the FY-to-date default — the mobile Filter
 *  button's badge count. */
function activeCount(f: FilterState): number {
  const def = fyDefault();
  return (f.customerId ? 1 : 0) + (f.agent ? 1 : 0) + (f.region ? 1 : 0) + (f.from !== def.from || f.to !== def.to ? 1 : 0);
}

/**
 * The report filter bar — date range (+ presets), customer, agent, region.
 *
 * Desktop: the same always-visible inline row it always had. Below `sm` that
 * row would either wrap into a wall of controls or force horizontal scroll —
 * neither is usable one-handed — so it collapses to a single glass summary
 * chip plus a "Filter" button (badge count) that opens the fields in a bottom
 * sheet, the same Filter-sheet pattern already used across the app (Quotations,
 * Tally Reconciliation, …).
 */
export function ReportFilterBar({ f, setF, active, onReset }: { f: FilterState; setF: (u: (p: FilterState) => FilterState) => void; active: boolean; onReset: () => void }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const count = activeCount(f);
  const fmtD = (v: string) => (v ? v.split('-').reverse().join('-') : 'any');

  return (
    <>
      {/* Desktop */}
      <div className="bg-card hidden flex-wrap items-end gap-2 rounded-xl border p-3 sm:flex">
        <FilterFields f={f} setF={setF} />
        <Button
          variant="outline"
          size="sm"
          className="border-rose-200 font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:border-input disabled:text-rose-600/40"
          onClick={onReset}
          disabled={!active}
          title={active ? 'Clear all filters' : 'No filters applied'}
        >
          <RotateCcw className="size-3.5" /> Reset
        </Button>
      </div>

      {/* Phones: glass summary chip + Filter button, matching the reports mobile skin. */}
      <div className="rp-rise flex items-center gap-2 sm:hidden">
        <div className="min-w-0 flex-1 rounded-2xl border border-white/76 bg-white/55 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow-[0_6px_18px_-12px_rgba(13,38,92,.4)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300">
          <span className="block truncate">{fmtD(f.from)} → {fmtD(f.to)} · {f.customerId ? 'Customer set' : 'All customers'} · {f.agent || 'All agents'} · {f.region || 'All regions'}</span>
        </div>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Filters"
          className={cn(
            'relative flex h-[38px] shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-[12px] font-bold shadow-sm active:scale-95',
            active
              ? 'border-blue-300 bg-gradient-to-br from-blue-600 to-blue-800 text-white'
              : 'border-white/80 bg-white/70 text-slate-700 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200',
          )}
        >
          <Filter className="size-3.5" /> Filter
          {count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex size-[18px] items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-700 text-[10px] font-extrabold text-white shadow-[0_2px_8px_-2px_rgba(225,29,72,.9)]">
              {count}
            </span>
          )}
        </button>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="sm:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button variant="ghost" size="sm" className="text-muted-foreground -mr-2 gap-1.5" onClick={onReset} disabled={!active}>
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4">
            <FilterFields f={f} setF={setF} stacked />
          </div>
          <SheetFooter>
            <Button className="w-full" onClick={() => setSheetOpen(false)}>Apply filters</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
