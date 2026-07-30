import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import type { ReportFilterOptions, ReportFilters } from '@oms/shared';
import { http } from '@/lib/api';
import { NativeSelect } from '@/components/common/combo';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

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

/** The report filter bar — date range (+ presets), customer, agent, region. */
export function ReportFilterBar({ f, setF, active, onReset }: { f: FilterState; setF: (u: (p: FilterState) => FilterState) => void; active: boolean; onReset: () => void }) {
  const { data } = useReportFilterOptions();
  const customers = data?.customers ?? [];
  const custName = f.customerId ? customers.find((c) => String(c.id) === f.customerId)?.name ?? '' : '';

  const applyPreset = (p: string) => setF((prev) => ({ ...prev, ...presetRange(p) }));

  return (
    <div className="bg-card flex flex-wrap items-end gap-2 rounded-xl border p-3">
      <div className="min-w-0">
        <Label className="text-muted-foreground mb-1 block text-xs">Period</Label>
        <NativeSelect value="" onChange={applyPreset} options={['', ...PRESETS]} placeholder="Quick range" className="w-44" />
      </div>
      <div>
        <Label className="text-muted-foreground mb-1 block text-xs">From</Label>
        <Input type="date" value={f.from} onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))} className="w-[9.5rem]" />
      </div>
      <div>
        <Label className="text-muted-foreground mb-1 block text-xs">To</Label>
        <Input type="date" value={f.to} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))} className="w-[9.5rem]" />
      </div>
      <div className="min-w-0 flex-1 basis-52">
        <Label className="text-muted-foreground mb-1 block text-xs">Customer</Label>
        <NativeSelect
          value={custName}
          onChange={(name) => setF((p) => ({ ...p, customerId: name ? String(customers.find((c) => c.name === name)?.id ?? '') : '' }))}
          options={['', ...customers.map((c) => c.name)]}
          placeholder="All customers"
        />
      </div>
      <div className="min-w-0 basis-40">
        <Label className="text-muted-foreground mb-1 block text-xs">Agent</Label>
        <NativeSelect value={f.agent} onChange={(v) => setF((p) => ({ ...p, agent: v }))} options={['', ...(data?.agents ?? [])]} placeholder="All agents" />
      </div>
      <div className="min-w-0 basis-40">
        <Label className="text-muted-foreground mb-1 block text-xs">Region</Label>
        <NativeSelect value={f.region} onChange={(v) => setF((p) => ({ ...p, region: v }))} options={['', ...(data?.regions ?? [])]} placeholder="All regions" />
      </div>
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
  );
}
