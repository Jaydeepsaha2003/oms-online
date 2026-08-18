import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, Loader2, Sigma, X } from 'lucide-react';
import type { DaybookDayGroup, DaybookRow } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { DateRangeCalendar } from '@/components/common/date-range-calendar';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePartyLedgerLookups } from './use-party-ledger';
import { useDaybook } from './use-daybook';

/** Remembered like the other per-screen view preferences (page size, column
 *  order): whoever reads the daybook as a flat voucher list shouldn't have to
 *  switch the day subtotals off on every visit. */
const SUBTOTALS_KEY = 'oms:daybook-subtotals';
const loadSubtotals = () => {
  try {
    return localStorage.getItem(SUBTOTALS_KEY) !== '0';
  } catch {
    return true; // private mode / quota — fall back to the default view
  }
};

const inr = (v: number) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
/** Blank/zero cells fill with "-" — standard accounting-statement style, matching
 *  Party Ledger's 3 summary rows. Every daybook row IS a summary line (no running
 *  detail rows like a per-party ledger has), so this applies throughout. */
const moneyOrDash = (v: number) => (v ? inr(v) : '-');
const prettyDate = (iso: string) => formatDate(iso);

/** Compact, amber-bordered filter controls — the same language as every other list page. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON =
  'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

/* ── Tally palette — same as Party Ledger: amber frame around a plain grid,
   navy→indigo column strip so the header matches every other list page. */
const TH =
  'sticky top-0 z-10 bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-left text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap dark:from-blue-900 dark:to-indigo-900';
const TH_LINE = 'border-r border-white/15';
const TD = 'border-r border-r-amber-200/80 px-2 py-[3px] align-middle dark:border-r-amber-400/15 last:border-r-0';
const NUM = 'text-right tabular-nums';
const PANEL = 'border-amber-300 dark:border-amber-400/30';

const FY_START_MONTH = 3; // April (0-based)
function fyStart(d: Date): Date {
  const y = d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, FY_START_MONTH, 1);
}
const RANGE_PRESETS = ['This Year', 'This Quarter', 'This Month', 'Yesterday', 'Today'] as const;
type Preset = (typeof RANGE_PRESETS)[number];
function presetRange(p: Preset): { from: Date; to: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fys = fyStart(today);
  const monthsSince = (today.getFullYear() - fys.getFullYear()) * 12 + (today.getMonth() - fys.getMonth());
  const qStart = new Date(fys.getFullYear(), fys.getMonth() + Math.max(0, Math.floor(monthsSince / 3)) * 3, 1);
  switch (p) {
    case 'Today':
      return { from: today, to: today };
    case 'Yesterday': {
      const y = new Date(today.getTime() - 86_400_000);
      return { from: y, to: y };
    }
    case 'This Month':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
    case 'This Quarter':
      return { from: qStart, to: today };
    case 'This Year':
    default:
      return { from: fys, to: today };
  }
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function FitSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  className?: string;
}) {
  const fitted = value ? `${Math.min(Math.max(value.length + 6, 12), 34)}ch` : undefined;
  return (
    <div className={cn('relative', className, value && 'sm:w-[var(--fit)]')} style={fitted ? ({ '--fit': fitted } as CSSProperties) : undefined}>
      <Label className="sr-only">{label}</Label>
      <NativeSelect value={value} onChange={onChange} options={['', ...options]} placeholder={label} className={cn(CONTROL, 'font-medium', value && CONTROL_ON)} />
    </div>
  );
}

/** One voucher line — date is blank after the first row of its group (Tally never
 *  repeats the date down a day's block). */
function DayRows({
  group,
  showDate,
  canViewChallan,
  onOpenChallan,
  subtotals,
}: {
  group: DaybookDayGroup;
  showDate: boolean;
  canViewChallan: boolean;
  onOpenChallan: (row: DaybookRow) => void;
  /** Off hides this day's "Day total" strip — the vouchers then read as one
   *  continuous list. The Grand Total is unaffected either way. */
  subtotals: boolean;
}) {
  return (
    <>
      {group.rows.map((r, i) => {
        const invoice = (r.voucherType.toUpperCase() === 'SALES INVOICE' || r.voucherType.toUpperCase() === 'DEBIT NOTE') && !!r.challanId && canViewChallan;
        return (
          <tr
            key={`${r.voucherNo}-${i}`}
            role={invoice ? 'button' : undefined}
            tabIndex={invoice ? 0 : undefined}
            onClick={invoice ? () => onOpenChallan(r) : undefined}
            onKeyDown={
              invoice
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenChallan(r);
                    }
                  }
                : undefined
            }
            className={cn(
              'border-b border-amber-200/70 outline-none dark:border-amber-400/10',
              'even:bg-amber-50/70 dark:even:bg-amber-400/[0.05]',
              'hover:bg-amber-200/80 dark:hover:bg-amber-400/20',
              'focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-inset',
              invoice && 'group cursor-pointer',
            )}
          >
            <td className={cn(TD, 'whitespace-nowrap tabular-nums font-semibold text-slate-700 dark:text-slate-300')}>{showDate && i === 0 ? prettyDate(group.date) : ''}</td>
            <td className={cn(TD, 'font-semibold text-slate-800 dark:text-slate-200')}>{r.customerName}</td>
            <td className={cn(TD, 'text-slate-700 dark:text-slate-300')}>{r.particulars}</td>
            <td className={cn(TD, 'whitespace-nowrap text-[12px] font-medium text-slate-600 dark:text-slate-400')}>{r.voucherType}</td>
            <td className={cn(TD, 'whitespace-nowrap text-[12.5px] font-semibold', invoice && 'font-bold text-amber-900 underline-offset-2 group-hover:underline dark:text-amber-300')}>{r.voucherNo}</td>
            <td className={cn(TD, NUM, 'font-semibold text-slate-900 dark:text-slate-100')}>{moneyOrDash(r.dr)}</td>
            <td className={cn(TD, NUM, 'font-semibold text-emerald-700 dark:text-emerald-400')}>{moneyOrDash(r.cr)}</td>
          </tr>
        );
      })}
      {subtotals && (
        <tr className="bg-amber-100/80 font-bold dark:bg-amber-400/10">
          <td className={TD} colSpan={4} />
          <td className={cn(TD, 'text-[11.5px] font-bold tracking-wide text-amber-950 uppercase dark:text-amber-100')}>Day total</td>
          <td className={cn(TD, NUM, 'font-bold')}>{moneyOrDash(group.totalDr)}</td>
          <td className={cn(TD, NUM, 'font-bold')}>{moneyOrDash(group.totalCr)}</td>
        </tr>
      )}
    </>
  );
}

export function DaybookPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canViewChallan = can('challan:print');

  const [from, setFrom] = useState(() => ymd(fyStart(new Date())));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [preset, setPreset] = useState<string>('');
  const [party, setParty] = useState('');
  const [voucherType, setVoucherType] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [subtotals, setSubtotals] = useState(loadSubtotals);

  useEffect(() => {
    try {
      localStorage.setItem(SUBTOTALS_KEY, subtotals ? '1' : '0');
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [subtotals]);

  const { data: lookups } = usePartyLedgerLookups();
  const custByName = useMemo(() => new Map((lookups?.customers ?? []).map((c) => [c.name, c.id])), [lookups]);
  const partyOptions = useMemo(() => [...custByName.keys()].sort((a, b) => a.localeCompare(b)), [custByName]);
  const customerId = party ? custByName.get(party) : undefined;

  const query = { from, to, voucherType: voucherType || undefined, customerId };
  const { data, isFetching } = useDaybook(query);

  const applyPreset = (p: Preset) => {
    const { from: f, to: t } = presetRange(p);
    setFrom(ymd(f));
    setTo(ymd(t));
    setPreset(p);
    setDateOpen(false);
  };
  const hasFilters = !!voucherType || !!party;
  const resetFilters = () => {
    setVoucherType('');
    setParty('');
  };
  const dateLabel = preset || `${prettyDate(from)} → ${prettyDate(to)}`;

  const totalRows = data?.groups.reduce((a, g) => a + g.rows.length, 0) ?? 0;

  const onOpenChallan = (r: DaybookRow) => {
    if (!r.challanId || !canViewChallan) return;
    navigate(`/challans/${r.challanId}/bill`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      <div className={cn('bg-card font-poppins rounded-[4px] border shadow-sm', PANEL)}>
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn(CONTROL, 'w-full justify-start gap-1.5 sm:w-auto', 'font-medium', (preset || from) && CONTROL_ON)}>
                <CalendarRange className="size-3.5 shrink-0" />
                <span className="truncate">{dateLabel}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              <div className="w-[15.5rem] space-y-2">
                <div className="grid grid-cols-2 gap-1">
                  {RANGE_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => applyPreset(p)}
                      aria-pressed={preset === p}
                      className={cn(
                        'cursor-pointer rounded-[3px] border px-2 py-1 text-[11.5px] font-semibold transition-colors',
                        preset === p ? 'border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-400/60 dark:bg-amber-400/15 dark:text-amber-200' : 'hover:bg-accent border-transparent',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="border-t pt-2">
                  <DateRangeCalendar
                    from={from}
                    to={to}
                    onChange={(f, t) => {
                      setFrom(f);
                      if (t) setTo(t);
                      setPreset('');
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 border-t pt-2">
                  <span className="min-w-0 truncate text-[11.5px] font-semibold">
                    {prettyDate(from)} <span className="text-muted-foreground">→</span> {prettyDate(to)}
                  </span>
                  <Button size="sm" className="h-7 shrink-0 px-3 text-[12px] font-semibold" onClick={() => setDateOpen(false)}>
                    Done
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <FitSelect label="Party" value={party} onChange={setParty} options={partyOptions} className="w-full sm:w-52" />

          <FitSelect label="Voucher type" value={voucherType} onChange={setVoucherType} options={data?.voucherTypes ?? []} className="w-full sm:w-44" />

          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={subtotals}
            onClick={() => setSubtotals((v) => !v)}
            title={subtotals ? 'Hide the per-day subtotal rows' : 'Show a subtotal row under each day'}
            className={cn(CONTROL, 'shrink-0 px-2.5 font-semibold', subtotals && CONTROL_ON)}
          >
            <Sigma className="size-3.5" /> Subtotals {subtotals ? 'ON' : 'OFF'}
          </Button>

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10" onClick={resetFilters}>
              <X className="size-3.5" /> Reset
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {data && (
              <p className="text-muted-foreground hidden text-[12px] font-medium lg:block">
                <span className="text-foreground font-bold tabular-nums">{totalRows}</span> row{totalRows === 1 ? '' : 's'}
                {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin align-[-2px]" />}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={cn('bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[4px] border shadow-sm', PANEL)}>
        <div className="flex items-center justify-between gap-3 bg-slate-800 px-2.5 py-1 dark:bg-slate-900">
          <span className="truncate text-[12px] font-extrabold tracking-wide text-amber-300 uppercase">Daybook — {party || 'All Parties'}</span>
          <span className="hidden shrink-0 text-[11px] font-bold tracking-wide text-white tabular-nums sm:inline">
            {prettyDate(from)} — {prettyDate(to)}
            {voucherType ? ` · ${voucherType}` : ''}
          </span>
        </div>

        {/* Desktop: the Tally grid. */}
        <div className={cn('hidden min-h-0 flex-1 overflow-auto overscroll-x-contain sm:block', '[scrollbar-width:thin] [scrollbar-color:var(--color-amber-400)_var(--color-amber-100)]')}>
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">Daybook from {prettyDate(from)} to {prettyDate(to)}</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(TH, TH_LINE, 'w-28')}>Date</th>
                <th scope="col" className={cn(TH, TH_LINE)}>Party</th>
                <th scope="col" className={cn(TH, TH_LINE)}>Particulars</th>
                <th scope="col" className={cn(TH, TH_LINE, 'w-36')}>Vch Type</th>
                <th scope="col" className={cn(TH, TH_LINE, 'w-32')}>Vch No</th>
                <th scope="col" className={cn(TH, TH_LINE, 'w-32 text-right')}>Debit</th>
                <th scope="col" className={cn(TH, 'w-32 text-right')}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {isFetching && !data ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground h-24 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              ) : !data?.groups.length ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground h-24 text-center text-[13px] font-medium">
                    No vouchers for these filters.
                  </td>
                </tr>
              ) : (
                data.groups.map((g) => (
                  <DayRows key={g.date} group={g} showDate canViewChallan={canViewChallan} onOpenChallan={onOpenChallan} subtotals={subtotals} />
                ))
              )}
            </tbody>
            {!!data?.groups.length && (
              <tfoot className="sticky bottom-0 z-20">
                <tr className="bg-amber-200/90 font-bold shadow-[inset_0_2px_0_0_var(--color-amber-700)] dark:bg-amber-400/20 dark:shadow-[inset_0_2px_0_0_var(--color-amber-400)]">
                  <td className={TD} colSpan={4} />
                  <td className={cn(TD, 'text-[13px] font-extrabold tracking-wide text-amber-950 uppercase dark:text-amber-100')}>Grand Total</td>
                  <td className={cn(TD, NUM, 'text-[13.5px] font-extrabold')}>{moneyOrDash(data.totalDr)}</td>
                  <td className={cn(TD, NUM, 'text-[13.5px] font-extrabold')}>{moneyOrDash(data.totalCr)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Phones: one card per day, one row per voucher inside. */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2 sm:hidden">
          {isFetching && !data ? (
            <div className="text-muted-foreground flex h-24 items-center justify-center">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : !data?.groups.length ? (
            <p className="text-muted-foreground px-4 py-10 text-center text-[13px] font-medium">No vouchers for these filters.</p>
          ) : (
            data.groups.map((g) => (
              <div key={g.date} className="bg-card overflow-hidden rounded-[4px] border border-amber-200 shadow-sm dark:border-amber-400/20">
                <div className="bg-slate-800 px-3 py-1.5 text-[11.5px] font-bold tracking-wide text-amber-300 uppercase dark:bg-slate-900">{prettyDate(g.date)}</div>
                <div className="divide-y divide-amber-200/70 dark:divide-amber-400/10">
                  {g.rows.map((r, i) => {
                    const invoice = (r.voucherType.toUpperCase() === 'SALES INVOICE' || r.voucherType.toUpperCase() === 'DEBIT NOTE') && !!r.challanId && canViewChallan;
                    return (
                      <div
                        key={`${r.voucherNo}-${i}`}
                        role={invoice ? 'button' : undefined}
                        onClick={invoice ? () => onOpenChallan(r) : undefined}
                        className={cn('p-2.5', invoice && 'cursor-pointer active:bg-amber-100/70 dark:active:bg-amber-400/15')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] leading-tight font-bold text-slate-900 dark:text-slate-100">{r.customerName}</p>
                            <p className="text-muted-foreground truncate text-[11.5px] font-medium">{r.particulars}</p>
                          </div>
                          <span className="text-muted-foreground shrink-0 text-[11px] font-bold tabular-nums">{r.voucherNo}</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[12.5px]">
                          <span className="text-muted-foreground text-[11px] font-semibold uppercase">{r.voucherType}</span>
                          <span className="flex gap-3 font-bold tabular-nums">
                            {r.dr ? <span className="text-slate-900 dark:text-slate-100">Dr {inr(r.dr)}</span> : null}
                            {r.cr ? <span className="text-emerald-700 dark:text-emerald-400">Cr {inr(r.cr)}</span> : null}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {subtotals && (
                  <div className="flex items-center justify-between border-t border-amber-300/60 bg-amber-100/80 px-3 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-amber-950 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
                    <span>Day total</span>
                    <span className="tabular-nums normal-case">{moneyOrDash(g.totalDr)} / {moneyOrDash(g.totalCr)}</span>
                  </div>
                )}
              </div>
            ))
          )}
          {!!data?.groups.length && (
            <div className="rounded-[4px] border-2 border-amber-600 bg-amber-100/80 px-3 py-2 shadow-[inset_0_2px_0_0_var(--color-amber-700)] dark:border-amber-400/60 dark:bg-amber-400/15 dark:shadow-[inset_0_2px_0_0_var(--color-amber-400)]">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-extrabold uppercase tracking-wide text-amber-950 dark:text-amber-100">Grand Total</span>
                <span className="text-[14px] font-extrabold tabular-nums">{moneyOrDash(data.totalDr)} / {moneyOrDash(data.totalCr)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DaybookPage;
