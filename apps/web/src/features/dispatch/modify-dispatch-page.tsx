import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Eye, Filter, Layers, Loader2, Lock, Pencil, Search, Trash2, TriangleAlert, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { ALL_PERMISSIONS, DISPATCH_STATUSES, MAX_PAGE_SIZE, RESOURCES, qtyOrderForCategory, type DispatchDto, type QtyField } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, shortDispatchCode, shortOrderCode } from '@/lib/utils';
import { DATE_FORMATS, formatDate, useDateFormat } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { usePageSize } from '@/hooks/use-page-size';
import { useOrderQtyLayout } from '@/features/settings/use-settings';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { RecordHistory } from '@/components/common/record-history';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DateRangeCalendar } from '@/components/common/date-range-calendar';
import { PRESETS, presetRange } from '@/features/challans/date-presets';
import { useDeleteDispatch, useDispatches, useDispatchFilterOptions, useLineLock, useUpdateDispatch } from './use-dispatch';
import { LiveLinePhotos } from '../orders/line-photos';
import { useOrderItemPhotos } from '../orders/use-orders';

const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? 0 : Number(s));
const qty = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');

const STATUS_STYLE: Record<string, string> = {
  'PARTIALLY DISPATCH': 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25',
  'FULLY DISPATCH': 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25',
};
const STATUS_DOT: Record<string, string> = {
  'PARTIALLY DISPATCH': 'bg-amber-500',
  'FULLY DISPATCH': 'bg-emerald-500',
};
/**
 * Whether this dispatch has been billed yet, and on which invoice. A dispatch
 * drops out of Pending Challan the moment a challan bills it, so without this
 * the row gives no clue why it's no longer there.
 */
const ChallanBadge = ({ d }: { d: DispatchDto }) =>
  d.challanCode ? (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-emerald-50 px-1.5 py-0.5 text-[11.5px] font-bold text-emerald-700 ring-1 ring-emerald-200 ring-inset dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25">
      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
      {d.challanCode}
    </span>
  ) : (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11.5px] font-semibold">
      <span className="bg-muted-foreground/40 size-1.5 shrink-0 rounded-full" />
      Not billed
    </span>
  );

/** A status pill with a coloured dot — carries the state alongside the word. */
const StatusBadge = ({ s }: { s: string }) => (
  <span className={cn('inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', STATUS_STYLE[s] ?? 'bg-muted text-muted-foreground ring-border')}>
    <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[s] ?? 'bg-slate-400')} />
    {s}
  </span>
);

/** Matches the Pending Challan / Challans / Orders grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

const COLUMNS: DataColumn<DispatchDto>[] = [
  { id: 'code', label: 'DIS#', pin: 'left0', pinWidthClass: 'sm:w-16 sm:min-w-16', fixed: true, cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums text-indigo-700 dark:text-indigo-300')}>{shortDispatchCode(d.code, d.id)}</span> },
  { id: 'date', label: 'Date', cell: (d) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{formatDate(d.dispatchDate)}</span> },
  { id: 'order', label: 'ORD#', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{shortOrderCode(d.orderCode, d.orderId)}</span> },
  { id: 'customer', label: 'Customer', cell: (d) => <span className={TEXT_CELL}>{d.customerName}</span> },
  { id: 'product', label: 'Product', cell: (d) => <span className={TEXT_CELL}>{d.productName || d.product || '—'}</span> },
  { id: 'design', label: 'Design Name', cell: (d) => <span className={TEXT_CELL}>{d.designType || '—'}</span> },
  { id: 'bags', label: 'Bags', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(d.bags)}</span> },
  { id: 'pcs', label: 'Pcs', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(d.pcs)}</span> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(d.gram)}</span> },
  { id: 'box', label: 'Box', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(d.box)}</span> },
  { id: 'status', label: 'Status', cell: (d) => <StatusBadge s={d.dispatchStatus} /> },
  { id: 'challan', label: 'Challan Status', cell: (d) => <ChallanBadge d={d} /> },
  { id: 'dispatchedBy', label: 'Dispatched By', cell: (d) => <span className={TEXT_CELL}>{d.userName || '—'}</span> },
  { id: 'remarks', label: 'Remarks', cell: (d) => <span className="text-muted-foreground text-[13px] font-medium">{d.comment || '—'}</span> },
];

const money = (v: number | null) => (v == null ? '—' : `₹${v.toLocaleString('en-IN')}`);

/** Rate columns, shown only with `dispatch:viewrates`. Amount = rate × the
 *  dispatched quantity (pcs or kgs, per the line's calc field). */
const RATE_COLUMNS: DataColumn<DispatchDto>[] = [
  { id: 'productRate', label: 'Product ₹', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(d.productRate)}</span> },
  { id: 'designRate', label: 'Design ₹', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(d.designRate)}</span> },
  { id: 'rate', label: 'Rate ₹', align: 'right', cell: (d) => <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(d.rate)}</span> },
  {
    id: 'amount',
    label: 'Amount ₹',
    align: 'right',
    cell: (d) => {
      const q = (d.calField ?? '').toUpperCase() === 'PCS' ? d.pcs : d.gram;
      return <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(d.rate != null && q != null ? Math.round(d.rate * q) : null)}</span>;
    },
  },
];

/** Insert rate columns just before the Remarks column (their default slot). */
const withRates = (cols: DataColumn<DispatchDto>[]): DataColumn<DispatchDto>[] => {
  const at = cols.findIndex((c) => c.id === 'remarks');
  const i = at < 0 ? cols.length : at;
  return [...cols.slice(0, i), ...RATE_COLUMNS, ...cols.slice(i)];
};

const MODIFY_CARD_CSS = `
.mdisp-card-in { animation: mdispIn .3s cubic-bezier(.22,1,.36,1) both; }
@keyframes mdispIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .mdisp-card-in { animation: none; } }
`;

/* ── Group by Date & Party (subtotal view) ────────────────────────────────────
 * Built for the labour floor: "how many bags/kgs/pcs/box do I load for THIS
 * party on THIS date" is a subtotal question, not a row-by-row one. Grouping
 * happens entirely client-side over whatever the current filters + date range
 * already fetched (the query switches to a much larger page size while this
 * view is on — see `grouped` in ModifyDispatchPage — so a subtotal is never
 * silently short by a page boundary). */

interface PartyGroup {
  party: string;
  lines: DispatchDto[];
  bags: number;
  pcs: number;
  kgs: number;
  box: number;
}
interface DateGroup {
  dateKey: string;
  parties: PartyGroup[];
  bags: number;
  pcs: number;
  kgs: number;
  box: number;
  lineCount: number;
}

/** ISO datetime → local YYYY-MM-DD, matching `toDateInput` below — the grouping key. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Today" / "Yesterday" — the quick-scan label a labourer reads first; falls
 *  back to the formatted date for anything further out. */
function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return formatDate(key);
}

function buildDateGroups(items: DispatchDto[]): DateGroup[] {
  const byDate = new Map<string, Map<string, PartyGroup>>();
  for (const d of items) {
    const dk = dayKey(d.dispatchDate);
    if (!byDate.has(dk)) byDate.set(dk, new Map());
    const parties = byDate.get(dk)!;
    const party = d.customerName?.trim() || '—';
    if (!parties.has(party)) parties.set(party, { party, lines: [], bags: 0, pcs: 0, kgs: 0, box: 0 });
    const p = parties.get(party)!;
    p.lines.push(d);
    p.bags += d.bags ?? 0;
    p.pcs += d.pcs ?? 0;
    p.kgs += d.gram ?? 0;
    p.box += d.box ?? 0;
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dateKey, partiesMap]) => {
      const parties = [...partiesMap.values()].sort((a, b) => a.party.localeCompare(b.party));
      const totals = parties.reduce(
        (acc, p) => ({ bags: acc.bags + p.bags, pcs: acc.pcs + p.pcs, kgs: acc.kgs + p.kgs, box: acc.box + p.box }),
        { bags: 0, pcs: 0, kgs: 0, box: 0 },
      );
      return { dateKey, parties, ...totals, lineCount: parties.reduce((a, p) => a + p.lines.length, 0) };
    });
}

/** Subtotal pills — only the units actually in play, so a Bags-only party
 *  never shows three dashes. `lg` + `light` power the mobile date banner. */
function GroupQtyBadges({
  bags,
  pcs,
  kgs,
  box,
  size = 'sm',
  tone = 'default',
}: {
  bags: number;
  pcs: number;
  kgs: number;
  box: number;
  size?: 'sm' | 'lg';
  tone?: 'default' | 'light';
}) {
  const vals = ([['Bags', bags], ['Pcs', pcs], ['Kgs', kgs], ['Box', box]] as const).filter(([, v]) => v > 0);
  if (!vals.length) return <span className={cn('text-xs', tone === 'light' ? 'text-white/70' : 'text-muted-foreground')}>No quantities</span>;
  return (
    <div className={cn('flex flex-wrap', size === 'lg' ? 'gap-2' : 'gap-1.5')}>
      {vals.map(([label, v]) => (
        <span
          key={label}
          className={cn(
            'inline-flex items-baseline gap-1 rounded-full border',
            tone === 'light' ? 'border-white/25 bg-white/10 text-white' : 'border-primary/15 bg-primary/5 text-primary',
            size === 'lg' ? 'px-3 py-1.5' : 'px-2 py-0.5',
          )}
        >
          <span className={cn('font-semibold uppercase', size === 'lg' ? 'text-[11px]' : 'text-[10px]', tone === 'light' ? 'opacity-80' : 'opacity-70')}>{label}</span>
          <span className={cn('font-bold tabular-nums', size === 'lg' ? 'text-[17px]' : 'text-[12.5px]')}>{qty(v)}</span>
        </span>
      ))}
    </div>
  );
}

/** One dispatch line, compact enough to sit inside an expanded desktop party
 *  group — the same facts as the flat table's row, in a single wrapped line. */
function GroupedLineRow({
  d,
  canEdit,
  canDelete,
  showRates,
  isSuperAdmin,
  onView,
  onEdit,
  onDelete,
}: {
  d: DispatchDto;
  canEdit: boolean;
  canDelete: boolean;
  showRates: boolean;
  isSuperAdmin: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const locked = !!d.challanCode;
  const amount = d.rate != null ? Math.round(d.rate * ((d.calField ?? '').toUpperCase() === 'PCS' ? (d.pcs ?? 0) : (d.gram ?? 0))) : null;
  const qtyText = ([['B', d.bags], ['P', d.pcs], ['K', d.gram], ['X', d.box]] as const)
    .filter(([, v]) => v && v > 0)
    .map(([u, v]) => `${qty(v)}${u}`)
    .join(' · ');
  return (
    <div className="bg-card flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-2.5 py-1.5 text-[12.5px]">
      <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">{shortDispatchCode(d.code, d.id)}</span>
      <span className="text-muted-foreground font-mono text-[11px]">{shortOrderCode(d.orderCode, d.orderId)}</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-slate-800 dark:text-slate-200">
        {d.productName || d.product || '—'}
        {d.designType && d.designType.toUpperCase() !== 'NA' ? ` · ${d.designType}` : ''}
      </span>
      <span className="text-muted-foreground tabular-nums">{qtyText || '—'}</span>
      <StatusBadge s={d.dispatchStatus} />
      <ChallanBadge d={d} />
      {showRates && <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(amount)}</span>}
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-6" onClick={onView} aria-label="View" title="View details">
          <Eye className="size-3.5" />
        </Button>
        <DispatchPhotosButton orderItemId={d.orderItemId} isSuperAdmin={isSuperAdmin} compact />
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={onEdit}
            aria-label={locked ? 'Edit status & photos' : 'Edit'}
            title={locked ? `Billed on ${d.challanCode} — status & photos only` : 'Edit'}
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
        {canDelete && (
          <Button variant="ghost" size="icon" className="size-6 text-destructive hover:text-destructive" onClick={onDelete} disabled={locked} aria-label="Delete" title={locked ? `Billed on ${d.challanCode} — cannot be deleted` : 'Delete'}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Desktop grouped view: a banner per date, a collapsible subtotal bar per
 *  party underneath, individual lines only on demand. */
function GroupedDesktopView({
  groups,
  expanded,
  onToggle,
  canEdit,
  canDelete,
  showRates,
  isSuperAdmin,
  onView,
  onEdit,
  onDelete,
}: {
  groups: DateGroup[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  canEdit: boolean;
  canDelete: boolean;
  showRates: boolean;
  isSuperAdmin: boolean;
  onView: (d: DispatchDto) => void;
  onEdit: (d: DispatchDto) => void;
  onDelete: (d: DispatchDto) => void;
}) {
  if (!groups.length) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-[4px] border border-dashed text-sm">
        No dispatch records match these filters.
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
      {groups.map((g) => (
        <div key={g.dateKey} className="overflow-hidden rounded-[4px] border shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-blue-900 to-indigo-900 px-3.5 py-2.5 text-white">
            <div className="flex items-center gap-2">
              <CalendarRange className="size-4 opacity-80" />
              <span className="text-[15px] font-extrabold tracking-wide">{dayLabel(g.dateKey)}</span>
              <span className="text-[12px] font-medium text-white/70 tabular-nums">{formatDate(g.dateKey)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[12px] font-semibold text-white/80">
                <Users className="size-3.5" /> {g.parties.length} part{g.parties.length === 1 ? 'y' : 'ies'}
              </span>
              <GroupQtyBadges bags={g.bags} pcs={g.pcs} kgs={g.kgs} box={g.box} tone="light" />
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-white/10">
            {g.parties.map((p) => {
              const key = `${g.dateKey}|${p.party}`;
              const open = expanded.has(key);
              return (
                <div key={key} className="bg-card">
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-amber-50 dark:hover:bg-amber-400/5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')} />
                      <span className="truncate text-[14px] font-bold text-slate-900 dark:text-slate-100">{p.party}</span>
                      <span className="text-muted-foreground shrink-0 text-[11.5px] font-semibold">
                        {p.lines.length} line{p.lines.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <GroupQtyBadges bags={p.bags} pcs={p.pcs} kgs={p.kgs} box={p.box} />
                  </button>

                  {open && (
                    <div className="space-y-1.5 border-t bg-slate-50/60 px-3.5 py-2 dark:bg-white/[0.02]">
                      {p.lines.map((d) => (
                        <GroupedLineRow key={d.id} d={d} canEdit={canEdit} canDelete={canDelete} showRates={showRates} isSuperAdmin={isSuperAdmin} onView={() => onView(d)} onEdit={() => onEdit(d)} onDelete={() => onDelete(d)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mobile grouped view — the labour-floor screen: a bold date banner, then one
 *  big tap card per party with the four subtotals as large stat tiles. Tap a
 *  party to reveal its individual lines (still fully editable). */
function GroupedMobileView({
  groups,
  expanded,
  onToggle,
  canEdit,
  canDelete,
  showRates,
  isSuperAdmin,
  onView,
  onEdit,
  onDelete,
}: {
  groups: DateGroup[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  canEdit: boolean;
  canDelete: boolean;
  showRates: boolean;
  isSuperAdmin: boolean;
  onView: (d: DispatchDto) => void;
  onEdit: (d: DispatchDto) => void;
  onDelete: (d: DispatchDto) => void;
}) {
  if (!groups.length) {
    return <div className="text-muted-foreground rounded-2xl border border-dashed bg-card px-4 py-12 text-center text-sm">No dispatch records match these filters.</div>;
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.dateKey} className="space-y-2.5">
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-gradient-to-r from-blue-900 to-indigo-900 px-4 py-3 text-white shadow-md">
            <div className="min-w-0">
              <p className="text-[18px] font-extrabold leading-tight">{dayLabel(g.dateKey)}</p>
              <p className="text-[11.5px] font-medium text-white/70">
                {formatDate(g.dateKey)} · {g.parties.length} part{g.parties.length === 1 ? 'y' : 'ies'}
              </p>
            </div>
            <GroupQtyBadges bags={g.bags} pcs={g.pcs} kgs={g.kgs} box={g.box} size="lg" tone="light" />
          </div>

          <div className="space-y-2.5">
            {g.parties.map((p) => {
              const key = `${g.dateKey}|${p.party}`;
              const open = expanded.has(key);
              return (
                <div key={key} className="bg-card overflow-hidden rounded-2xl border shadow-sm">
                  <button type="button" onClick={() => onToggle(key)} className="active:bg-muted/60 flex w-full flex-col gap-2.5 p-4 text-left transition-colors [touch-action:manipulation]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[17px] leading-tight font-bold">{p.party}</p>
                      <ChevronDown className={cn('text-muted-foreground size-5 shrink-0 transition-transform', open && 'rotate-180')} />
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {([['Bags', p.bags], ['Pcs', p.pcs], ['Kgs', p.kgs], ['Box', p.box]] as const).map(([label, v]) => (
                        <div key={label} className={cn('rounded-xl px-1 py-2 text-center', v > 0 ? 'bg-primary/[0.07]' : 'bg-muted/40 opacity-50')}>
                          <p className="text-muted-foreground text-[9.5px] font-bold tracking-widest uppercase">{label}</p>
                          <p className="text-[18px] leading-tight font-extrabold tabular-nums">{v > 0 ? qty(v) : '—'}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-muted-foreground text-[11.5px] font-semibold">
                      {p.lines.length} line{p.lines.length === 1 ? '' : 's'} · tap to {open ? 'collapse' : 'view'}
                    </p>
                  </button>

                  {open && (
                    <div className="space-y-2 border-t bg-slate-50/60 p-3 dark:bg-white/[0.02]">
                      {p.lines.map((d, i) => (
                        <ModifyDispatchCard key={d.id} d={d} index={i} canEdit={canEdit} canDelete={canDelete} showRates={showRates} isSuperAdmin={isSuperAdmin} onView={() => onView(d)} onEdit={() => onEdit(d)} onDelete={() => onDelete(d)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Phone card for one dispatch record — the readable, tappable equivalent of a
 *  table row, with inline Edit / Delete actions matching the user's permissions. */
function ModifyDispatchCard({
  d,
  index,
  canEdit,
  canDelete,
  showRates,
  isSuperAdmin,
  onView,
  onEdit,
  onDelete,
}: {
  d: DispatchDto;
  index: number;
  canEdit: boolean;
  canDelete: boolean;
  showRates: boolean;
  isSuperAdmin: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const qtys = ([['Bags', d.bags], ['Pcs', d.pcs], ['Kgs', d.gram], ['Box', d.box]] as const).filter(([, v]) => v && v > 0);
  const amount = d.rate != null ? Math.round(d.rate * ((d.calField ?? '').toUpperCase() === 'PCS' ? (d.pcs ?? 0) : (d.gram ?? 0))) : null;
  // Billed lines: qty/date/remarks are locked but status & photos can still be changed.
  const locked = !!d.challanCode;
  return (
    <div className="mdisp-card-in bg-card relative overflow-hidden rounded-2xl border shadow-sm" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
      <div className="space-y-2.5 p-3.5 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-[13px] font-bold">{shortDispatchCode(d.code, d.id)}</span>
            <span className="text-muted-foreground font-mono text-[12px]">{shortOrderCode(d.orderCode, d.orderId)}</span>
          </div>
          <StatusBadge s={d.dispatchStatus} />
        </div>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold leading-tight">{d.customerName}</p>
            <p className="text-muted-foreground mt-0.5 text-[12px]">{formatDate(d.dispatchDate)}</p>
          </div>
          <ChallanBadge d={d} />
        </div>

        <div className="bg-muted/50 rounded-lg px-3 py-1.5">
          <p className="text-[14.5px] leading-snug font-semibold">{d.productName || d.product || '—'}</p>
          {d.designType && d.designType.toUpperCase() !== 'NA' && <p className="text-muted-foreground text-[12px]">{d.designType}</p>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {qtys.length ? (
            qtys.map(([label, v]) => (
              <span key={label} className="border-primary/15 bg-primary/5 text-primary inline-flex items-baseline gap-1 rounded-full border px-2.5 py-1">
                <span className="text-[11px] font-semibold uppercase opacity-70">{label}</span>
                <span className="text-[14px] font-bold tabular-nums">{qty(v)}</span>
              </span>
            ))
          ) : (
            <span className="text-muted-foreground text-[13px]">No quantities</span>
          )}
        </div>

        {showRates && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-[12px]">
            <span>Rate <span className="text-foreground font-semibold tabular-nums">{money(d.rate)}</span></span>
            <span>Amount <span className="text-foreground font-semibold tabular-nums">{money(amount)}</span></span>
          </div>
        )}

        {d.userName && <p className="text-muted-foreground text-[11.5px]">Dispatched by <span className="text-foreground font-semibold">{d.userName}</span></p>}
        {d.comment && <p className="text-muted-foreground text-[12.5px] leading-snug">{d.comment}</p>}
      </div>

      {/* Actions mirror the desktop row's set — view, photos, edit, delete —
          so the same four are reachable on either platform. */}
      <div className="flex border-t text-[12.5px] font-semibold">
        <button
          type="button"
          onClick={onView}
          className="text-foreground/80 active:bg-muted flex flex-1 items-center justify-center gap-1.5 py-2.5 transition-colors"
          title="View details"
        >
          <Eye className="size-4" /> View
        </button>
        <div className="bg-border w-px" />
        <div className="flex flex-1 items-center justify-center py-1">
          <DispatchPhotosButton orderItemId={d.orderItemId} isSuperAdmin={isSuperAdmin} />
        </div>
        {canEdit && (
          <>
            <div className="bg-border w-px" />
            <button
              type="button"
              onClick={onEdit}
              className="text-primary active:bg-primary/5 flex flex-1 items-center justify-center gap-1.5 py-2.5 transition-colors"
              title={locked ? `Billed on ${d.challanCode} — status & photos only` : 'Edit dispatch'}
            >
              <Pencil className="size-4" /> Edit
            </button>
          </>
        )}
        {canDelete && !locked && (
          <>
            <div className="bg-border w-px" />
            <button type="button" onClick={onDelete} className="text-destructive active:bg-destructive/5 flex flex-1 items-center justify-center gap-1.5 py-2.5 transition-colors">
              <Trash2 className="size-4" /> Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ModifyDispatchPage() {
  const { can, permissions } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [designFilter, setDesignFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [datePreset, setDatePreset] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  // Phones: only Search + Customer + Item show up top; Agent/Design/Status live
  // behind this Filter icon (same pattern as Dispatch Order) — Date range and
  // Group already have their own compact, self-contained mobile controls
  // (Popover with its own Done button; a plain toggle), so they stay visible
  // rather than adding a second "apply" step inside the sheet.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [draftAgent, setDraftAgent] = useState('');
  const [draftDesign, setDraftDesign] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  // Subtotal view: groups the current filtered set by Date then Party. Off by
  // default (keeps today's flat-table behaviour); switching it on pulls a much
  // larger page so a subtotal is never short by a page boundary (see `query`).
  const [grouped, setGrouped] = useState(false);
  const [expandedParties, setExpandedParties] = useState<Set<string>>(new Set());
  const toggleParty = (key: string) =>
    setExpandedParties((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const { page, setPage, pageSize, setPageSize } = usePageSize('dispatch-modify');
  const [editing, setEditing] = useState<DispatchDto | null>(null);
  const [viewing, setViewing] = useState<DispatchDto | null>(null);
  const canViewRates = can('dispatch:viewrates');
  const columns = useMemo(() => (canViewRates ? withRates(COLUMNS) : COLUMNS), [canViewRates]);
  const cols = useColumnOrder('dispatch-modify', columns);
  const { format, setFormat } = useDateFormat();
  // Cascading options: pass the active filters so each dropdown only lists values
  // that still exist under the others.
  const { data: options } = useDispatchFilterOptions({
    status: statusFilter || undefined,
    customer: customerFilter || undefined,
    agent: agentFilter || undefined,
    product: productFilter || undefined,
    design: designFilter || undefined,
  });

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = {
    // Grouped mode needs every matching row to subtotal correctly, not just one
    // page — MAX_PAGE_SIZE comfortably covers a day's (or a filtered range's)
    // dispatch volume. Ungrouped keeps the normal paged table untouched.
    page: grouped ? 1 : page,
    pageSize: grouped ? MAX_PAGE_SIZE : pageSize,
    search: search || undefined,
    status: statusFilter || undefined,
    customer: customerFilter || undefined,
    agent: agentFilter || undefined,
    product: productFilter || undefined,
    design: designFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };
  // Live refresh every 2s — paused while the edit dialog is open, so a
  // background refetch can never reset a quantity someone is mid-editing.
  const { data, isLoading } = useDispatches(query, { autoRefresh: !editing });
  const del = useDeleteDispatch();
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const dateActive = !!(dateFrom || dateTo || datePreset);
  const dateGroups = useMemo(() => (grouped ? buildDateGroups(items) : []), [grouped, items]);
  const partyCount = useMemo(() => new Set(items.map((d) => d.customerName?.trim() || '—')).size, [items]);

  const applyDatePreset = (p: string) => {
    if (p === datePreset) {
      setDatePreset('');
      setDateFrom('');
      setDateTo('');
      setPage(1);
      return;
    }
    setDatePreset(p);
    const r = presetRange(p);
    if (r) {
      setDateFrom(r.from);
      setDateTo(r.to);
      setPage(1);
    }
  };
  const clearDates = () => {
    setDateFrom('');
    setDateTo('');
    setDatePreset('');
    setPage(1);
  };
  const dateLabel = datePreset || (dateFrom || dateTo ? `${dateFrom ? formatDate(dateFrom) : '…'} → ${dateTo ? formatDate(dateTo) : '…'}` : 'Any date');
  // Shared body of the Date popover — same control on mobile and desktop.
  const datePanel = (
    <div className="w-[15.5rem] space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyDatePreset(p)}
            aria-pressed={datePreset === p}
            className={cn(
              'cursor-pointer rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors duration-150',
              datePreset === p
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-muted/40 text-slate-600 hover:border-primary/40 hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="border-t pt-2">
        <DateRangeCalendar
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => {
            setDateFrom(f);
            setDateTo(t);
            setDatePreset('');
            setPage(1);
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <span className="min-w-0 truncate text-[11.5px] font-semibold">
          {dateActive ? (
            <>
              {dateFrom ? formatDate(dateFrom) : '…'} <span className="text-muted-foreground">→</span> {dateTo ? formatDate(dateTo) : '…'}
            </>
          ) : (
            <span className="text-muted-foreground font-medium">All dates</span>
          )}
        </span>
        <div className="flex shrink-0 gap-1.5">
          {dateActive && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] font-semibold" onClick={clearDates}>
              Clear
            </Button>
          )}
          <Button size="sm" className="h-7 shrink-0 px-3 text-[12px] font-semibold" onClick={() => setDateOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );

  const hasFilters = !!(statusFilter || customerFilter || agentFilter || productFilter || designFilter || dateActive);
  const resetFilters = () => {
    setStatusFilter('');
    setCustomerFilter('');
    setAgentFilter('');
    setProductFilter('');
    setDesignFilter('');
    clearDates();
    setPage(1);
  };
  // The behind-the-icon count on mobile — just the three fields the sheet holds.
  const sheetFilterCount = (agentFilter ? 1 : 0) + (designFilter ? 1 : 0) + (statusFilter ? 1 : 0);
  const draftDirty = !!(draftAgent || draftDesign || draftStatus || agentFilter || designFilter || statusFilter);
  // Open the mobile sheet with its drafts seeded from what's currently applied.
  const openMobileFilters = () => {
    setDraftAgent(agentFilter);
    setDraftDesign(designFilter);
    setDraftStatus(statusFilter);
    setMobileFiltersOpen(true);
  };
  // "Show results": commit the drafts to the real filter state, then close.
  const applyDraftFilters = () => {
    setAgentFilter(draftAgent);
    setDesignFilter(draftDesign);
    setStatusFilter(draftStatus);
    setPage(1);
    setMobileFiltersOpen(false);
  };
  // Sheet "Reset": clear only what lives behind the Filter icon, applied right away.
  const resetSheetFilters = () => {
    setDraftAgent('');
    setDraftDesign('');
    setDraftStatus('');
    setAgentFilter('');
    setDesignFilter('');
    setStatusFilter('');
    setPage(1);
  };

  const handleDelete = async (d: DispatchDto) => {
    if (d.challanCode) return toast.error(`Billed on ${d.challanCode} — cannot be deleted.`);
    const ok = await confirm({
      title: 'Delete dispatch?',
      description: `${d.code ?? `#${d.id}`} will be removed and its quantity returned to the pending list.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(d.id, {
      onSuccess: () => toast.success('Dispatch deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  return (
    // Fills the viewport: toolbar pinned on top, footer pinned at the bottom, only
    // the list scrolls. `/dispatch` is a flush route (app-shell), so the page owns
    // its own padding. Mobile keeps its own tap-to-edit card list untouched.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Toolbar: search + filters, then column settings — one card. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search #, customer, item, design name or remark…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          {/* Phones: just the two filters people actually reach for first —
              Customer and Item — each on their own full-width line. Everything
              else (Agent / Design / Status) lives behind the Filter icon; Date
              range and Group already have their own compact, self-contained
              controls, so they stay visible in the row below rather than
              needing a second "apply" step inside the sheet. */}
          <div className="flex w-full flex-col gap-2 sm:hidden">
            <NativeSelect value={customerFilter} onChange={(v) => { setCustomerFilter(v); setPage(1); }} options={['', ...(options?.customers ?? [])]} placeholder="Customer" className={cn(CONTROL, 'font-medium', customerFilter && CONTROL_ON)} />
            <NativeSelect value={productFilter} onChange={(v) => { setProductFilter(v); setPage(1); }} options={['', ...(options?.products ?? [])]} placeholder="Item" className={cn(CONTROL, 'font-medium', productFilter && CONTROL_ON)} digitsFirst />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className={cn('relative size-9 shrink-0 rounded-[4px] border-amber-300', sheetFilterCount > 0 && CONTROL_ON)} onClick={openMobileFilters} aria-label="More filters">
                <Filter className="size-4" />
                {sheetFilterCount > 0 && (
                  <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold tabular-nums">
                    {sheetFilterCount}
                  </span>
                )}
              </Button>
              {hasFilters && (
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9 shrink-0 rounded-[4px] border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
                  onClick={resetFilters}
                  aria-label="Reset all filters"
                  title="Reset all filters"
                >
                  <X className="size-4" />
                </Button>
              )}
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn(CONTROL, 'min-w-0 flex-1 font-medium', dateActive && CONTROL_ON)} title="Filter by dispatch date">
                    <CalendarRange className="size-3.5 shrink-0" />
                    <span className="truncate">{dateLabel}</span>
                    <ChevronDown className="size-3 shrink-0 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="font-poppins w-auto max-w-[calc(100vw-1.5rem)] p-2.5">
                  {datePanel}
                </PopoverContent>
              </Popover>
            </div>
            <label
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 rounded-[4px] border px-2.5 py-2 text-[12.5px] font-semibold select-none',
                grouped ? 'border-primary/40 bg-primary/5 text-primary' : 'border-amber-300 text-slate-600 dark:border-amber-400/40',
              )}
            >
              <span className="flex items-center gap-1.5">
                <Layers className="size-3.5" /> Group by Date &amp; Party
              </span>
              <Switch checked={grouped} onCheckedChange={setGrouped} />
            </label>
          </div>

          {/* Desktop: filters inline. */}
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            {/* Filter order follows the house pattern: Customer, Item Name, Agent,
                Category, Sub Category, Design Name (skipping whichever of those this
                page doesn't have — there's no Category/Sub Category filter here). */}
            <div className="sm:w-40">
              <NativeSelect value={customerFilter} onChange={(v) => { setCustomerFilter(v); setPage(1); }} options={['', ...(options?.customers ?? [])]} placeholder="All customers" className={cn(CONTROL, 'font-medium', customerFilter && CONTROL_ON)} />
            </div>
            <div className="sm:w-40">
              {/* Digits-first keyboard: item names begin with a size number. */}
              <NativeSelect value={productFilter} onChange={(v) => { setProductFilter(v); setPage(1); }} options={['', ...(options?.products ?? [])]} placeholder="All items" className={cn(CONTROL, 'font-medium', productFilter && CONTROL_ON)} digitsFirst />
            </div>
            <div className="sm:w-36">
              <NativeSelect value={agentFilter} onChange={(v) => { setAgentFilter(v); setPage(1); }} options={['', ...(options?.agents ?? [])]} placeholder="All agents" className={cn(CONTROL, 'font-medium', agentFilter && CONTROL_ON)} />
            </div>
            <div className="sm:w-44">
              <NativeSelect value={designFilter} onChange={(v) => { setDesignFilter(v); setPage(1); }} options={['', ...(options?.designs ?? [])]} placeholder="All design names" className={cn(CONTROL, 'font-medium', designFilter && CONTROL_ON)} />
            </div>
            <div className="sm:w-36">
              <NativeSelect value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={['', ...DISPATCH_STATUSES]} placeholder="All statuses" className={cn(CONTROL, 'font-medium', statusFilter && CONTROL_ON)} />
            </div>

            {/* Dispatch-date range — scopes the Group by Date & Party view (and the
                flat table too, when set). */}
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn(CONTROL, 'max-w-52 font-medium', dateActive && CONTROL_ON)} title="Filter by dispatch date">
                  <CalendarRange className="size-3.5 shrink-0" />
                  <span className="truncate">{dateLabel}</span>
                  <ChevronDown className="size-3 shrink-0 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="font-poppins w-auto max-w-[calc(100vw-1.5rem)] p-2.5">
                {datePanel}
              </PopoverContent>
            </Popover>

            {/* The subtotal view — see GroupedDesktopView / GroupedMobileView below. */}
            <label
              className={cn(
                'flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[4px] border px-2.5 text-[12.5px] font-semibold whitespace-nowrap select-none',
                grouped ? 'border-primary/40 bg-primary/5 text-primary' : 'border-amber-300 text-slate-600 dark:border-amber-400/40',
              )}
              title="Group the current list by Date, then Party — with a running subtotal of Bags/Pcs/Kgs/Box for each"
            >
              <Layers className="size-3.5" />
              <Switch checked={grouped} onCheckedChange={setGrouped} />
              Group by Date &amp; Party
            </label>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
                onClick={resetFilters}
                title="Clear all filters"
              >
                <X className="size-3.5" /> Reset
              </Button>
            )}

            <div className="ml-auto shrink-0">
              <ColumnSettings
                columns={cols.orderedReorderable}
                hidden={cols.hidden}
                onReorder={cols.moveBefore}
                onMove={cols.move}
                onToggle={cols.toggle}
                onReset={cols.reset}
                dateFormat={{ value: format, options: DATE_FORMATS, onChange: setFormat }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Phones only: Agent / Design / Status live behind the Filter icon above. */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="sm:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button variant="ghost" size="sm" className="-mr-2 gap-1.5 font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:text-rose-600/40" onClick={resetSheetFilters} disabled={!draftDirty}>
                <X className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Agent</Label>
              <NativeSelect value={draftAgent} onChange={setDraftAgent} options={['', ...(options?.agents ?? [])]} placeholder="All agents" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Design</Label>
              <NativeSelect value={draftDesign} onChange={setDraftDesign} options={['', ...(options?.designs ?? [])]} placeholder="All design names" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Status</Label>
              <NativeSelect value={draftStatus} onChange={setDraftStatus} options={['', ...DISPATCH_STATUSES]} placeholder="All statuses" />
            </div>
          </div>
          <SheetFooter>
            <Button className="h-11 w-full text-base font-semibold" onClick={applyDraftFilters}>
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* The table/card list takes the leftover height and scrolls WITHIN itself
          (both directions on desktop), so the horizontal scrollbar sits right
          under the visible rows instead of being pushed to the bottom of a long
          table that only the page's own scroll could ever reach. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        {/* Desktop: the grouped subtotal view, or the flat data table. */}
        <div className="hidden min-h-0 flex-1 sm:flex sm:flex-col">
          {grouped ? (
            isLoading ? (
              <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            ) : (
              <GroupedDesktopView
                groups={dateGroups}
                expanded={expandedParties}
                onToggle={toggleParty}
                canEdit={can('dispatch:update')}
                canDelete={can('dispatch:delete')}
                showRates={canViewRates}
                isSuperAdmin={permissions.includes(ALL_PERMISSIONS)}
                onView={(d) => setViewing(d)}
                onEdit={(d) => setEditing(d)}
                onDelete={(d) => handleDelete(d)}
              />
            )
          ) : (
          <DataTable
            columns={cols.visibleColumns}
            rows={items}
            rowKey={(d) => d.id}
            isLoading={isLoading}
            dense
            // Bounded to the space actually left on screen — its own scroll
            // region (vertical + horizontal) stays fully visible on first
            // paint, no scrolling the whole page down to reach it.
            fill
            hideSortIcon
            emptyText="No dispatch records yet."
            // Once a challan has billed this line, its qty is an invoiced fact —
            // editing/deleting it here would silently desync the two, so it's
            // read-only from this point on (backend enforces the same rule).
            onRowClick={(d) => can('dispatch:update') && !d.challanCode && setEditing(d)}
            className={[
              'font-sans text-[13px]',
              // Rows are click-to-edit, so block accidental text selection (a
              // stray drag while scrolling otherwise highlights the row's text).
              '[&_tbody]:select-none',
              '[&_thead_th]:text-[13.5px] [&_thead_th]:font-extrabold [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:py-1.5',
              '[&_thead_th_button]:cursor-pointer',
              '[&_thead_th:hover]:from-blue-900 [&_thead_th:hover]:to-indigo-900',
              '[&_td]:py-1 [&_td]:px-3 [&_th]:px-3',
              '[&_tbody_button:not([role=switch]):not([role=checkbox])]:size-7',
              '[&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 dark:[&_tbody_tr]:border-white/10',
              '[&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0',
              '[&_tbody_tr:nth-child(even)_td]:bg-slate-100/80 dark:[&_tbody_tr:nth-child(even)_td]:bg-white/[0.04]',
              '[&_tbody_tr:hover:hover_td]:bg-amber-100/70 dark:[&_tbody_tr:hover:hover_td]:bg-amber-400/10',
            ].join(' ')}
            actions={(d) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setViewing(d)} aria-label="View" title="View details">
                  <Eye className="size-4" />
                </Button>
                <DispatchPhotosButton orderItemId={d.orderItemId} isSuperAdmin={permissions.includes(ALL_PERMISSIONS)} />
                <RecordHistory
                  resource={RESOURCES.DISPATCH}
                  resourceId={d.id}
                  label={d.code ?? `#${d.id}`}
                  // Billing never happens *on* the dispatch, so it leaves no audit
                  // entry here — state the current position explicitly instead.
                  summary={
                    d.challanCode ? (
                      <span>
                        Billed on challan <span className="font-semibold">{d.challanCode}</span>
                        {d.challanStatus ? ` · ${d.challanStatus}` : ''}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not billed yet — still pending challan.</span>
                    )
                  }
                />
                {can('dispatch:update') && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setEditing(d)}
                    aria-label={d.challanCode ? 'Edit status & photos' : 'Edit'}
                    title={d.challanCode ? `Billed on ${d.challanCode} — status & photos only` : 'Edit'}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
                {can('dispatch:delete') && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(d)}
                    disabled={!!d.challanCode}
                    aria-label="Delete"
                    title={d.challanCode ? `Billed on ${d.challanCode} — cannot be deleted` : 'Delete'}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            )}
          />
          )}
        </div>

        {/* Phones: the grouped subtotal view, or the flat tap-to-edit card list.
            Own scroll region now that the outer wrapper doesn't scroll (that's
            the desktop table's job via `fill` above). */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto sm:hidden">
          <style>{MODIFY_CARD_CSS}</style>
          {isLoading ? (
            [0, 1, 2, 3].map((i) => <div key={i} className="bg-muted/40 h-44 animate-pulse rounded-2xl border" />)
          ) : grouped ? (
            <GroupedMobileView
              groups={dateGroups}
              expanded={expandedParties}
              onToggle={toggleParty}
              canEdit={can('dispatch:update')}
              canDelete={can('dispatch:delete')}
              showRates={canViewRates}
              isSuperAdmin={permissions.includes(ALL_PERMISSIONS)}
              onView={(d) => setViewing(d)}
              onEdit={(d) => setEditing(d)}
              onDelete={(d) => handleDelete(d)}
            />
          ) : items.length === 0 ? (
            <div className="text-muted-foreground rounded-2xl border border-dashed bg-card px-4 py-12 text-center text-sm">No dispatch records yet.</div>
          ) : (
            items.map((d, i) => (
              <ModifyDispatchCard
                key={d.id}
                d={d}
                index={i}
                canEdit={can('dispatch:update')}
                canDelete={can('dispatch:delete')}
                showRates={canViewRates}
                isSuperAdmin={permissions.includes(ALL_PERMISSIONS)}
                onView={() => setViewing(d)}
                onEdit={() => setEditing(d)}
                onDelete={() => handleDelete(d)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Footer: paging, or (grouped) a quick summary — there's no paging to do
          once every matching row has already been fetched for the subtotal. ── */}
      <div className="bg-card flex items-center justify-between rounded-[4px] border px-3 py-2 shadow-sm">
        {grouped ? (
          <p className="text-muted-foreground text-[12px] font-medium">
            <span className="font-bold tabular-nums text-foreground">{items.length}</span> line{items.length === 1 ? '' : 's'} ·{' '}
            <span className="font-bold tabular-nums text-foreground">{partyCount}</span> part{partyCount === 1 ? 'y' : 'ies'} ·{' '}
            <span className="font-bold tabular-nums text-foreground">{dateGroups.length}</span> date{dateGroups.length === 1 ? '' : 's'}
          </p>
        ) : (
          <p className="text-muted-foreground text-[12px] font-medium">
            Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
            <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
          </p>
        )}
        <div className={cn('flex items-center gap-3', grouped && 'hidden')}>
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      {viewing && <ViewDispatchDialog dispatch={viewing} onClose={() => setViewing(null)} />}
      {editing && <EditDispatchDialog dispatch={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Maps the shared QtyField key ('kgs') to this dialog's own form key ('gram'). */
const QTY_FIELD_INFO: Record<QtyField, { key: 'bags' | 'pcs' | 'gram' | 'box'; label: string }> = {
  bags: { key: 'bags', label: 'Bags' },
  pcs: { key: 'pcs', label: 'Pcs' },
  kgs: { key: 'gram', label: 'Kgs' },
  box: { key: 'box', label: 'Box' },
};
/** Bags/Pcs/Kgs/Box in the order configured for this dispatch's product category
 *  (Settings → Order quantity fields) — same layout as the New Order form. */
const orderedQtyFields = (qtyLayout: Parameters<typeof qtyOrderForCategory>[0], pCategory: string | null) =>
  qtyOrderForCategory(qtyLayout, pCategory).map((f) => QTY_FIELD_INFO[f]);

/** ISO datetime → the `YYYY-MM-DD` an `<input type="date">` needs, in local time
 *  (a plain `.slice(0, 10)` on an ISO string would use UTC and can land on the
 *  wrong day). */
const toDateInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Standalone camera-icon button that opens a read-only photo viewer dialog
 *  for the given order-item — usable from both the flat table's action column
 *  and the grouped desktop view's line rows. */
function DispatchPhotosButton({ orderItemId, isSuperAdmin, compact = false }: { orderItemId: number; isSuperAdmin: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { data: photos } = useOrderItemPhotos(orderItemId);
  const count = photos?.length ?? 0;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn('relative', compact ? 'size-6' : 'size-7')}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label="View photos"
        title={count > 0 ? `View ${count} photo${count === 1 ? '' : 's'}` : 'No photos'}
      >
        <Camera className={compact ? 'size-3.5' : 'size-4'} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-indigo-600 text-[8px] font-bold tabular-nums text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Camera className="size-4" /> Line photos
              </DialogTitle>
            </DialogHeader>
            <LiveLinePhotos orderItemId={orderItemId} canEdit={false} canDelete={isSuperAdmin} hideHeader />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/**
 * Read-only detail view of one dispatch. The edit dialog can't serve this role:
 * it takes the line lock (blocking other users) and it's unavailable entirely
 * for billed lines — which are exactly the ones you most often just want to
 * look at. So "view" is its own, always-available action.
 */
function ViewDispatchDialog({ dispatch: d, onClose }: { dispatch: DispatchDto; onClose: () => void }) {
  const { formatDate: fmtDate } = useDateFormat();
  const fmt = (iso: string | null) => (iso ? fmtDate(iso) : '—');
  const { can } = usePermissions();
  const showRates = can('dispatch:viewrates');
  const amount =
    d.rate != null ? Math.round(d.rate * ((d.calField ?? '').toUpperCase() === 'PCS' ? (d.pcs ?? 0) : (d.gram ?? 0))) : null;

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5 last:border-0">
      <span className="text-muted-foreground shrink-0 text-[11px] font-semibold tracking-wide uppercase">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-medium break-words">{children}</span>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Eye className="size-4" />
            <span className="font-mono">{shortDispatchCode(d.code, d.id)}</span>
            <StatusBadge s={d.dispatchStatus} />
            <ChallanBadge d={d} />
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <Row label="Item">{d.productName || d.product || '—'}</Row>
          <Row label="Design">{d.designType && d.designType.toUpperCase() !== 'NA' ? d.designType : '—'}</Row>
          <Row label="Party">{d.customerName}</Row>
          {d.agentName && <Row label="Agent">{d.agentName}</Row>}
          <Row label="Order">{shortOrderCode(d.orderCode, d.orderId)}</Row>
          <Row label="Dispatch date">{fmt(d.dispatchDate)}</Row>
          <Row label="Bags">{qty(d.bags)}</Row>
          <Row label="Pcs">{qty(d.pcs)}</Row>
          <Row label="Kgs">{qty(d.gram)}</Row>
          <Row label="Box">{qty(d.box)}</Row>
          {showRates && (
            <>
              <Row label="Rate">{d.rate != null ? money(d.rate) : '—'}</Row>
              <Row label="Amount">{money(amount)}</Row>
            </>
          )}
          <Row label="Billed on">
            {d.challanCode ? `${d.challanCode}${d.challanStatus ? ` · ${d.challanStatus}` : ''}` : 'Not billed yet'}
          </Row>
          {d.comment && <Row label="Remarks">{d.comment}</Row>}
          <Row label="Entered by">{d.userName || '—'}</Row>
          <Row label="Created">{fmt(d.createdAt)}</Row>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDispatchDialog({ dispatch, onClose }: { dispatch: DispatchDto; onClose: () => void }) {
  const { can, permissions } = usePermissions();
  const canApprove = can('dispatch:approve');
  // Everyone who can open this dialog can VIEW the line's photos; only a true
  // super admin (the '*' wildcard grant, not just dispatch:manage) may delete
  // one — these are proof-of-dispatch, so cleanup is deliberately narrow.
  const isSuperAdmin = permissions.includes(ALL_PERMISSIONS);
  // Billed dispatches: qty/date/remarks are frozen on the challan — only
  // dispatchStatus and photos are editable from this dialog.
  const locked = !!dispatch.challanCode;
  const [photosOpen, setPhotosOpen] = useState(false);
  const { data: photos } = useOrderItemPhotos(dispatch.orderItemId);
  const update = useUpdateDispatch(dispatch.id);
  // Editing lock: blocks this dialog outright if someone else already has this
  // same order line open — here or in the Dispatch form on the same item.
  const lockDenied = useLineLock(dispatch.orderItemId);
  useEffect(() => {
    if (!lockDenied) return;
    toast.error(lockDenied);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockDenied]);
  const { data: qtyLayout } = useOrderQtyLayout();
  const qtyFields = useMemo(() => orderedQtyFields(qtyLayout, dispatch.pCategory), [qtyLayout, dispatch.pCategory]);
  const s = (v: number | null) => (v == null ? '' : String(v));
  const [form, setForm] = useState({
    bags: s(dispatch.bags),
    pcs: s(dispatch.pcs),
    gram: s(dispatch.gram),
    box: s(dispatch.box),
    dispatchStatus: dispatch.dispatchStatus,
    comment: dispatch.comment ?? '',
    dispatchDate: toDateInput(dispatch.dispatchDate),
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const dateChanged = form.dispatchDate !== toDateInput(dispatch.dispatchDate);

  const submit = () => {
    if (update.isPending) return; // guard a double-fire (fast Ctrl+S + click)
    // Billed dispatch: only the status is changeable — skip qty validation and
    // send only the status so we don't accidentally trigger the backend's billed guard.
    if (locked) {
      update.mutate(
        { dispatchStatus: form.dispatchStatus },
        {
          onSuccess: () => { toast.success('Dispatch status updated'); onClose(); },
          onError: (e) => toast.error(getApiErrorMessage(e, 'Update failed')),
        },
      );
      return;
    }
    const cf = (dispatch.calField ?? '').toUpperCase();
    if (cf === 'PCS' && num(form.pcs) <= 0) return toast.error('Pcs is required — this item is priced by PCS.');
    if (cf === 'KGS' && num(form.gram) <= 0) return toast.error('Kgs is required to dispatch this item.');
    update.mutate(
      {
        bags: num(form.bags),
        pcs: num(form.pcs),
        gram: num(form.gram),
        box: num(form.box),
        dispatchStatus: form.dispatchStatus,
        comment: form.comment.trim() || null,
        dispatchDate: form.dispatchDate,
      },
      {
        onSuccess: (res) => {
          if (res.dateApprovalCode) {
            // Everything else saved; the date move itself is now waiting on a
            // sign-off and the dispatch keeps its ORIGINAL date until then.
            toast.success('Dispatch updated', {
              description: `The date change needs admin approval — see ${res.dateApprovalCode}.`,
            });
          } else {
            toast.success('Dispatch updated');
          }
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Update failed')),
      },
    );
  };

  // Ctrl/Cmd+S saves (bound once; always calls the latest closure via the ref).
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>Edit dispatch</span>
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-sm font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
              {shortDispatchCode(dispatch.code, dispatch.id)}
            </span>
            <span className="ml-auto">
              <StatusBadge s={form.dispatchStatus} />
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Read-only context — what this dispatch is for. */}
          <div className="from-primary/[0.07] rounded-lg border bg-gradient-to-r to-transparent p-3">
            <div className="text-sm font-semibold">
              {dispatch.productName || dispatch.product}
              {dispatch.designType && dispatch.designType.toUpperCase() !== 'NA' ? ` · ${dispatch.designType}` : ''}
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs">
              {dispatch.customerName} · {shortOrderCode(dispatch.orderCode, dispatch.orderId)}
            </div>
          </div>

          {/* Billed-dispatch notice — qty/date/remarks are locked; only status & photos allowed. */}
          {locked && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Billed on challan <span className="font-bold">{dispatch.challanCode}</span> — quantities, date and remarks are locked.
                You can still change the <span className="font-bold">dispatch status</span> and <span className="font-bold">manage photos</span>.
              </span>
            </div>
          )}

          {/* Dispatch date — editable (unlocked only). */}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Dispatch date</Label>
            <Input
              type="date"
              value={form.dispatchDate}
              onChange={(e) => set({ dispatchDate: e.target.value })}
              className="h-10 text-base tabular-nums"
              disabled={locked}
            />
            {dateChanged && !canApprove && !locked && (
              <p className="flex items-center gap-1 text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
                <TriangleAlert className="size-3.5 shrink-0" /> This move needs admin approval — everything else you change here still saves right away.
              </p>
            )}
          </div>

          {/* Quantities — disabled when billed. */}
          <div className="space-y-1.5">
            <Label className={cn('text-[11px] font-semibold tracking-wide uppercase', locked ? 'text-muted-foreground/50' : 'text-muted-foreground')}>Quantities</Label>
            <div className="grid grid-cols-4 gap-2.5">
              {qtyFields.map(({ key: k, label }) => (
                <div key={k} className="space-y-1">
                  <Label className={cn('text-[11px] font-medium', locked && 'text-muted-foreground/50')}>{label}</Label>
                  <Input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    className="h-10 text-right text-base tabular-nums"
                    value={form[k]}
                    onChange={(e) => set({ [k]: e.target.value } as Partial<typeof form>)}
                    disabled={locked}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Status — always editable, even for billed dispatches. */}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Dispatch status</Label>
            <div className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1">
              {[...DISPATCH_STATUSES].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => set({ dispatchStatus: val })}
                  className={cn(
                    'rounded-md py-2 text-xs font-bold transition-all active:scale-[0.98]',
                    form.dispatchStatus === val
                      ? cn('bg-card shadow-sm', val === 'FULLY DISPATCH' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')
                      : 'text-muted-foreground',
                  )}
                >
                  {val === 'FULLY DISPATCH' ? 'Fully dispatched' : 'Partially dispatched'}
                </button>
              ))}
            </div>
          </div>

          {/* Remarks — disabled when billed. */}
          <div className="space-y-1.5">
            <Label className={cn('text-[11px] font-semibold tracking-wide uppercase', locked ? 'text-muted-foreground/50' : 'text-muted-foreground')}>Remarks</Label>
            <Input value={form.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Dispatch remark…" disabled={locked} />
          </div>

          {/* Line photos — always accessible. Adding/rearranging allowed for all;
              deleting only for super admins (proof-of-dispatch cleanup is narrow). */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/30">
            <button type="button" onClick={() => setPhotosOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <Camera className="size-3.5" /> Line photos
                {!!photos?.length && (
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">{photos.length}</span>
                )}
              </span>
              <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', photosOpen && 'rotate-180')} />
            </button>
            {photosOpen && (
              <div className="px-3 pb-3">
                {/* canEdit=true so photos can be added/viewed even after billing;
                    canDelete is restricted to super admins as before. */}
                <LiveLinePhotos orderItemId={dispatch.orderItemId} canEdit={true} canDelete={isSuperAdmin} hideHeader />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={update.isPending} title="Save changes (Ctrl+S)">
            {update.isPending ? <Loader2 className="animate-spin" /> : null} Save
            <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold sm:inline">Ctrl+S</kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModifyDispatchPage;
