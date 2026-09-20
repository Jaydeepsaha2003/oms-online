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
 * Desktop: the same always-visible inline row it always had.
 *
 * Below `sm` it becomes the rest of the mockup's header. `ReportHeader` draws
 * the blue hero with square bottom corners and this continues the same blue
 * block directly beneath it (the page gap is closed in CSS), holding
 * the quick-range chips and the Filter button, and carrying the 30px bottom
 * rounding. The applied filters then read as the first glass chip of the
 * scroller, with Reset on it — exactly the mockup's layout. The fields
 * themselves live in a bottom sheet, the pattern already used across the app.
 *
 * It relies on being rendered immediately after `ReportHeader`, which is true
 * on all nine reports.
 */
export function ReportFilterBar({ f, setF, active, onReset }: { f: FilterState; setF: (u: (p: FilterState) => FilterState) => void; active: boolean; onReset: () => void }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { data } = useReportFilterOptions();
  const count = activeCount(f);
  const fmtD = (v: string) => (v ? v.split('-').reverse().join('-') : 'any');
  const custName = f.customerId ? data?.customers.find((c) => String(c.id) === f.customerId)?.name ?? 'Customer set' : 'All customers';
  // Which preset (if any) the current range is exactly — lights that chip up.
  const currentPreset = PRESETS.find((p) => {
    const r = presetRange(p);
    return r.from === f.from && r.to === f.to;
  });

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

      {/* Phones: the blue header continues here — range chips + Filter. */}
      <div className="rp-headbar sm:hidden">
        <div className="relative flex items-center gap-2">
          <div className="rp-noscroll flex min-w-0 flex-1 gap-[7px] overflow-x-auto">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className="rp-range-chip"
                data-on={currentPreset === p}
                onClick={() => setF((prev) => ({ ...prev, ...presetRange(p) }))}
              >
                {p}
              </button>
            ))}
          </div>
          <button type="button" className="rp-hero-btn shrink-0" onClick={() => setSheetOpen(true)} aria-label="Filters">
            <Filter className="size-3.5" /> Filter
            {count > 0 && <span className="rp-hero-badge">{count}</span>}
          </button>
        </div>
      </div>

      {/* Phones: what is applied right now, with the way out. */}
      <div className="rp-filterline sm:hidden">
        <span className="rp-filterline-icon"><Filter className="size-3" /></span>
        <div className="min-w-0 flex-1 truncate">
          {fmtD(f.from)} → {fmtD(f.to)} · {custName} · {f.agent || 'All agents'} · {f.region || 'All regions'}
        </div>
        {active && <button type="button" className="rp-reset" onClick={onReset}>Reset</button>}
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
