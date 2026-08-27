import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, History, IndianRupee, Loader2, Pencil, Plus, Receipt, Trash2, TriangleAlert, Users } from 'lucide-react';
import { toast } from 'sonner';
import { basisUnit, COMMISSION_BASES, type AgentRateCoverageRow, type CommissionBasis } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAgents } from '@/features/agents/use-agents';
import { useOrderLookups } from '@/features/orders/use-orders';
import { AllRatesPanel } from './all-rates-panel';
import { SpecialCommissionPanel } from './special-commission';
import {
  useCommissionRates,
  useRateImpact,
  useCreateCommissionRate,
  useDeleteCommissionRate,
  useRateCoverage,
} from './use-agent-commission';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (n: number) => n.toLocaleString('en-IN');

/** Register header / body cell. Sized to be read across the room — this table
 *  is where unpaid agents get spotted, so nothing in it should need squinting. */
const RTH =
  'sticky top-0 border-b bg-gradient-to-b from-blue-800 to-indigo-800 px-3 py-2.5 text-left text-[12px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap';
const RTD = 'px-3 py-2.5 align-middle text-[13.5px]';

/**
 * Agent → category → ₹ per kg or per piece.
 *
 * Built as a grid of what the business actually sells rather than a list of the
 * rates that happen to exist, because the dangerous state here is the ABSENT
 * row: an agent invoicing a category nobody priced earns nothing, silently, and
 * a list of existing rates can never show you that. Every square the agent
 * sells is on screen whether it's priced or not, and the unpriced ones are the
 * loudest thing on the page.
 */
export function CommissionRatesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const canEdit = can('agentcommission:update');

  const { data: coverage, isLoading } = useRateCoverage();
  const { data: agentList } = useAgents({ page: 1, pageSize: 500 });
  const { data: allRates } = useCommissionRates();
  const { data: lookups } = useOrderLookups();

  const [editing, setEditing] = useState<{ agentId: number; agentName: string; pCategory: string; basis: CommissionBasis } | null>(null);
  const [adding, setAdding] = useState(false);
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [tab, setTab] = useState<'BASE' | 'SPECIAL' | 'ALL'>('BASE');

  const rows = coverage ?? [];
  const agentsInGrid = useMemo(() => [...new Set(rows.map((r) => r.agentName))].sort(), [rows]);
  const categories = useMemo(() => [...new Set(rows.map((r) => r.pCategory))].sort(), [rows]);
  const gaps = useMemo(() => rows.filter((r) => r.gap), [rows]);
  const priced = rows.length - gaps.length;

  /**
   * The oldest invoice sitting under an unpriced pairing.
   *
   * The count of gaps says how much is unpriced; this says how long it has been
   * that way, which is the part that decides whether it matters. It also gives
   * the date to type into "Effective from" to catch every one of them.
   */
  const oldestGap = useMemo(() => {
    const dated = gaps.filter((g) => g.firstInvoiceDate);
    if (!dated.length) return null;
    return dated.reduce((a, b) => (a.firstInvoiceDate! <= b.firstInvoiceDate! ? a : b));
  }, [gaps]);

  /**
   * The register, unpriced first and then by invoice volume.
   *
   * Sorted by what needs doing rather than alphabetically: the pairing with 65
   * unpriced invoices is the one to fix first, and on an alphabetical list it
   * could sit anywhere. Serial numbers follow this order, so "row 3" means the
   * third most urgent, not the third agent by name.
   */
  const shown = useMemo(() => {
    const list = onlyGaps ? rows.filter((r) => r.gap) : rows;
    return [...list].sort(
      (a, b) =>
        Number(b.gap) - Number(a.gap) ||
        b.invoiceCount - a.invoiceCount ||
        a.agentName.localeCompare(b.agentName) ||
        a.pCategory.localeCompare(b.pCategory),
    );
  }, [rows, onlyGaps]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-2.5 font-sans sm:p-3">
      {/* ── Tabs + the one action ─────────────────────────────────────────
          No page title here: the app bar already shows "Commission Rates", and
          printing it again pushed the actual content below the fold on a laptop.
          The tab strip names the screen well enough.

          No "re-price invoices" button either — saving a rate prices the
          invoices it reaches there and then, and a new invoice prices itself on
          save. A button for it was a step that could be skipped, and skipping it
          left a rate on screen while every settlement still paid the old one.
          ── Base rates vs the exceptions to them ─────────────────────────
          Two tabs rather than two screens: they are the same question at two
          levels of detail, and a special rate is only understandable next to the
          base rate it replaces. */}
      <div className="flex h-9 w-full items-center gap-1 rounded-[4px] border border-indigo-200 bg-indigo-50/40 p-0.5 sm:w-auto sm:self-start dark:border-indigo-400/30 dark:bg-indigo-500/10">
        {(
          [
            ['BASE', 'Base rates'],
            ['SPECIAL', 'Special commission'],
            ['ALL', 'All rates'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              'flex-1 rounded-[3px] px-3 py-1 text-[12px] font-semibold transition-colors sm:flex-none',
              tab === value ? 'bg-indigo-600 text-white shadow-sm' : 'text-indigo-900/70 hover:bg-indigo-100 dark:text-indigo-200/80 dark:hover:bg-indigo-500/20',
            )}
          >
            {label}
          </button>
        ))}
        {canEdit && (
          <Button size="sm" className="bg-gradient-brand ml-auto h-9 text-white shadow-sm hover:opacity-95" onClick={() => setAdding(true)}>
            <Plus /> Set a rate
          </Button>
        )}
      </div>

      {/* ── Please set the missing rates ──────────────────────────────────
          Shown above BOTH tabs, because it is the one thing standing between
          the user and any figures at all: pricing runs by itself, so an empty
          Ledger or Settlement means only that a rate is missing here. */}
      {!!gaps.length && (
        <div className="flex items-start gap-2 rounded-[4px] border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {/* One short sentence of what is wrong, one of what to do. The old
              version packed the count, the invoice total, the oldest invoice,
              the date advice and how pricing works into a single paragraph, and
              the instruction — the only actionable part — was last. */}
          <p>
            <b>
              {gaps.length === 1 ? '1 rate is missing' : `${gaps.length} rates are missing`}
            </b>{' '}
            — {gaps.reduce((s, g) => s + g.invoiceCount, 0).toLocaleString('en-IN')} dispatched invoices are paying the agent
            nothing.{' '}
            {tab === 'BASE' ? 'Use Set on any red row below.' : 'Open the Base rates tab to set them.'}
            {oldestGap && (
              <>
                {' '}Oldest unpaid invoice: <b>{oldestGap.firstInvoiceNo ?? '—'}</b>,{' '}
                <b>{formatDate(oldestGap.firstInvoiceDate!)}</b> ({oldestGap.agentName} · {oldestGap.pCategory}) — start the
                rate from that date to cover everything since.
              </>
            )}
          </p>
        </div>
      )}

      {tab === 'SPECIAL' && <SpecialCommissionPanel />}
      {tab === 'ALL' && <AllRatesPanel />}

      {tab === 'BASE' && (
        <>
      {/* ── What the grid adds up to ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Agents selling" value={agentsInGrid.length} tone="slate" />
        <Stat label="Categories sold" value={categories.length} tone="slate" />
        <Stat label="Priced" value={priced} tone="emerald" />
        <Stat
          label="Earning nothing"
          value={gaps.length}
          tone={gaps.length ? 'rose' : 'emerald'}
          hint={gaps.length ? 'agent sells it, no rate set' : 'every category is priced'}
          onClick={gaps.length ? () => setOnlyGaps((v) => !v) : undefined}
          active={onlyGaps}
        />
        {/* Not another count — the DATE. "6 unpriced" says how much; this says
            since when, which is what decides whether it matters, and it is the
            date to put in "Effective from" to catch all of it. */}
        <Stat
          label="Unpriced since"
          value={oldestGap?.firstInvoiceDate ? formatDate(oldestGap.firstInvoiceDate) : '—'}
          tone={oldestGap ? 'rose' : 'emerald'}
          hint={oldestGap ? `${oldestGap.firstInvoiceNo ?? 'invoice'} · ${oldestGap.agentName}` : 'nothing unpriced'}
          icon={CalendarClock}
        />
      </div>

      {/* ── The rate register ───────────────────────────────────────────────
          One row per agent–category pairing, numbered, rather than the old
          agent × category matrix. A matrix reads as mostly empty the moment
          there are more categories than any one agent sells, gives every cell
          the same width whatever is in it, and has nowhere to put the facts that
          decide the work — how many invoices are affected, and how far back they
          go. A register has a column for each of those. */}
      <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-slate-50/80 px-3 py-2 dark:bg-white/[0.03]">
          <span className="text-[12.5px] font-bold">Rate register</span>
          <span className="text-muted-foreground text-[11.5px]">
            {shown.length} of {rows.length} pairing{rows.length === 1 ? '' : 's'} · agent × category, as actually invoiced
          </span>
          {onlyGaps && (
            <Button variant="ghost" size="sm" className="ml-auto h-7 text-[12px]" onClick={() => setOnlyGaps(false)}>
              Showing unpriced only — show all
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : !rows.length ? (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-1 px-6 text-center text-[13px]">
              <p className="font-medium">No invoiced categories yet.</p>
              <p>Once invoices exist for parties with an agent, every category they sell appears here to be priced.</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className={cn(RTH, 'w-10 text-center')}>#</th>
                  <th className={RTH}>Agent</th>
                  <th className={RTH}>Category</th>
                  <th className={cn(RTH, 'text-center')}>Unit</th>
                  <th className={cn(RTH, 'text-right')}>Rate</th>
                  <th className={cn(RTH, 'text-center')}>Status</th>
                  <th className={cn(RTH, 'text-right')}>Invoices</th>
                  <th className={cn(RTH, 'text-right')}>Quantity</th>
                  <th className={RTH}>First invoice</th>
                  <th className={RTH}>Last invoice</th>
                  <th className={RTH}>Rate since</th>
                  <th className={cn(RTH, 'w-20 text-center')}>Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const unit = r.basis ?? r.suggestedBasis;
                  const open = canEdit
                    ? () => setEditing({ agentId: r.agentId, agentName: r.agentName, pCategory: r.pCategory, basis: r.basis ?? r.suggestedBasis ?? 'KGS' })
                    : undefined;
                  return (
                    <tr
                      key={`${r.agentId}|${r.pCategory}`}
                      onClick={open}
                      className={cn(
                        'border-b transition-colors',
                        // The unpriced rows are the work list, so they carry the
                        // only colour in the table; everything else stays quiet
                        // zebra striping so the numbers are what stands out.
                        r.gap ? 'bg-rose-50/70 hover:bg-rose-100/70 dark:bg-rose-500/10' : 'odd:bg-slate-50/60 hover:bg-indigo-50/60 dark:odd:bg-white/[0.02]',
                        open && 'cursor-pointer',
                      )}
                    >
                      <td className={cn(RTD, 'text-muted-foreground text-center tabular-nums')}>{i + 1}</td>
                      <td className={cn(RTD, 'font-bold whitespace-nowrap')}>{r.agentName}</td>
                      <td className={cn(RTD, 'font-semibold whitespace-nowrap')}>{r.pCategory}</td>
                      <td className={cn(RTD, 'text-muted-foreground text-center whitespace-nowrap')}>{unit ? `per ${basisUnit(unit)}` : '—'}</td>
                      <td className={cn(RTD, 'text-right font-bold tabular-nums whitespace-nowrap')}>
                        {r.ratePerUnit == null ? (
                          <span className="text-muted-foreground font-normal">—</span>
                        ) : (
                          <span className="inline-flex items-baseline gap-1.5">
                            <span className="text-emerald-700 dark:text-emerald-400">
                              ₹{r.ratePerUnit}
                              <span className="text-muted-foreground text-[11.5px] font-normal">/{basisUnit(r.basis ?? 'KGS')}</span>
                            </span>
                            {/* Charged through to customers — visible without
                                opening the rate, since it is a PRICE decision
                                affecting every party this agent sells to. */}
                            {r.addToRate && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                title="Added onto the product price for every party this agent sells this category to"
                              >
                                <Receipt className="size-2.5" /> in rate
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className={cn(RTD, 'text-center')}>
                        {r.gap ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11.5px] font-bold text-rose-700 ring-1 ring-inset ring-rose-300 dark:bg-rose-500/20 dark:text-rose-300">
                            <TriangleAlert className="size-3" /> NOT SET
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300">
                            PRICED
                          </span>
                        )}
                      </td>
                      <td className={cn(RTD, 'text-right font-semibold tabular-nums')}>{num(r.invoiceCount)}</td>
                      <td className={cn(RTD, 'text-right tabular-nums whitespace-nowrap')}>
                        {/* The quantity in the unit the rate is charged in — the
                            other one is not what the money is calculated on. */}
                        {unit ? `${num(unit === 'PCS' ? r.pcs : r.kgs)} ${basisUnit(unit)}` : '—'}
                      </td>
                      {/* The pair of dates says how long this has been the case:
                          an unpriced row reaching back a year is a different
                          problem from one that started last week. */}
                      <td className={cn(RTD, 'whitespace-nowrap')}>
                        {r.firstInvoiceDate ? (
                          <>
                            <span className="font-mono text-[13px] font-semibold">{r.firstInvoiceNo ?? '—'}</span>
                            <span className="text-muted-foreground ml-1.5 text-[12.5px] tabular-nums">{formatDate(r.firstInvoiceDate)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={cn(RTD, 'text-muted-foreground tabular-nums whitespace-nowrap')}>
                        {r.lastInvoiceDate ? formatDate(r.lastInvoiceDate) : '—'}
                      </td>
                      <td className={cn(RTD, 'tabular-nums whitespace-nowrap')}>
                        {r.effectiveFrom ? formatDate(r.effectiveFrom) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={cn(RTD, 'text-center')}>
                        {canEdit && (
                          <Button
                            variant={r.gap ? 'default' : 'outline'}
                            size="sm"
                            className="h-8 px-2.5 text-[12.5px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              open?.();
                            }}
                          >
                            {r.gap ? <Plus className="size-3.5" /> : <Pencil className="size-3.5" />}
                            {r.gap ? 'Set' : 'Edit'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="[&_td]:sticky [&_td]:bottom-0 [&_td]:border-t-2 [&_td]:border-slate-300 [&_td]:bg-slate-100 [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-[13.5px] [&_td]:font-bold dark:[&_td]:border-white/20 dark:[&_td]:bg-slate-800">
                  <td colSpan={6} className="text-[12.5px] tracking-wide uppercase">
                    Total — {shown.filter((r) => r.gap).length} unpriced of {shown.length}
                  </td>
                  <td className="text-right tabular-nums">{num(shown.reduce((a, r) => a + r.invoiceCount, 0))}</td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <p className="text-muted-foreground border-t px-3 py-1.5 text-[11.5px]">
          Rates are dated, never overwritten — an invoice always prices at the rate in force on its invoice date, so changing one here never rewrites
          what has already been settled. Saving a rate prices every invoice it reaches straight away, and a new invoice prices itself when it is raised.
        </p>
      </div>

        </>
      )}

      {(editing || adding) && (
        <RateDialog
          seed={editing}
          agents={(agentList?.items ?? []).map((a) => ({ id: a.id, name: a.name }))}
          categories={categories}
          lookups={lookups}
          history={allRates ?? []}
          historyLoaded={!!allRates}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone, hint, onClick, active, icon: Icon }: {
  label: string;
  /** A count, or a short string (a date) — the strip mixes both. */
  value: number | string;
  tone: 'slate' | 'emerald' | 'rose';
  hint?: string;
  onClick?: () => void;
  active?: boolean;
  icon?: typeof CalendarClock;
}) {
  const tones = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rose: 'border-rose-300 bg-rose-50 text-rose-700',
  } as const;
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        'rounded-[4px] border px-3 py-2 text-left shadow-sm transition-all',
        tones[tone],
        onClick && 'hover:shadow-md cursor-pointer',
        active && 'ring-2 ring-rose-400 ring-offset-1',
        !onClick && 'cursor-default',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide opacity-80">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className={cn('font-extrabold leading-tight tabular-nums', typeof value === 'number' ? 'text-[22px]' : 'text-[16px]')}>
        {typeof value === 'number' ? num(value) : value}
      </div>
      {hint && <div className="text-[10.5px] font-medium opacity-80">{hint}</div>}
    </button>
  );
}

/** One square: the rate, or a gap that says what it is costing. */
/* ── Set / change a rate ──────────────────────────────────────────────────── */

function RateDialog({ seed, agents, categories, lookups, history, historyLoaded, onClose }: {
  seed: { agentId: number; agentName: string; pCategory: string; basis: CommissionBasis } | null;
  agents: { id: number; name: string }[];
  categories: string[];
  lookups: ReturnType<typeof useOrderLookups>['data'];
  history: import('@oms/shared').AgentCommissionRateDto[];
  /** False until the rate history has actually arrived — the form must not be
   *  seeded from an empty list and then left blank once the real rates land. */
  historyLoaded: boolean;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const create = useCreateCommissionRate();
  const del = useDeleteCommissionRate();
  const { can } = usePermissions();

  const categoryBasis = useMemo(() => {
    const m = new Map<string, CommissionBasis>();
    for (const cf of lookups?.categoryFields ?? []) m.set(cf.category.trim().toUpperCase(), cf.field === 'PCS' ? 'PCS' : 'KGS');
    return m;
  }, [lookups]);

  const allCategories = useMemo(
    () => [...new Set([...categories, ...(lookups?.categories ?? []).map((c) => c.trim().toUpperCase())])].filter(Boolean).sort(),
    [categories, lookups],
  );

  const [agentName, setAgentName] = useState(seed?.agentName ?? '');
  const [pCategory, setPCategory] = useState(seed?.pCategory ?? '');
  const [basis, setBasis] = useState<CommissionBasis>(seed?.basis ?? 'KGS');
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(ymd(new Date()));
  const [note, setNote] = useState('');
  /*
   * Charge this commission through to the customer as well as paying the agent.
   *
   * Seeded from the rate currently in force, because saving here writes the NEXT
   * dated rate for the same pairing — silently dropping back to "off" would
   * quietly stop charging it through on the next rate change, which is a price
   * cut nobody asked for. See the effect below for why it is not just an
   * initialiser.
   */
  const [addToRate, setAddToRate] = useState(false);

  const suggested = categoryBasis.get(pCategory.trim().toUpperCase());
  const overridden = !!suggested && suggested !== basis;

  const pickCategory = (c: string) => {
    setPCategory(c);
    const s = categoryBasis.get(c.trim().toUpperCase());
    if (s) setBasis(s);
  };

  // Everything ever set for this agent + category, newest first.
  const past = useMemo(
    () =>
      history
        .filter((h) => h.agentName === agentName && h.pCategory === pCategory.trim().toUpperCase())
        .sort((a, b) => +new Date(b.effectiveFrom) - +new Date(a.effectiveFrom)),
    [history, agentName, pCategory],
  );
  const current = past.find((h) => h.current);

  /*
   * What this date would actually price.
   *
   * "Effective from" defaulted to today, and a rate dated today prices nothing
   * when every invoice for that agent is older — correct, since an invoice must
   * keep the rate in force on its own date, but indistinguishable from the
   * feature not working. So: a FIRST rate for this pairing starts from the
   * agent's earliest invoice (from-today is never what anyone means when
   * setting a rate up), and the count is shown live either way.
   */
  const impact = useRateImpact({
    agentId: agents.find((a) => a.name === agentName)?.id,
    pCategory: pCategory.trim().toUpperCase() || undefined,
    effectiveFrom: effectiveFrom || undefined,
  });
  const seededRef = useRef('');
  useEffect(() => {
    const key = `${agentName}|${pCategory.trim().toUpperCase()}`;
    const earliest = impact.data?.earliestInvDate;
    // Only for the first rate on this pairing, and only once per pairing — a
    // date the user has since typed must never be pulled back.
    if (!earliest || past.length || seededRef.current === key || !agentName || !pCategory.trim()) return;
    seededRef.current = key;
    setEffectiveFrom(ymd(new Date(earliest)));
  }, [impact.data?.earliestInvDate, past.length, agentName, pCategory]);

  /*
   * Load the rate in force into the form.
   *
   * Edit used to open on an empty amount with a hardcoded "40" placeholder, so
   * an existing rate looked like a blank new one — and the placeholder happening
   * to match the real rate made it worse. Amount, unit and the charge-through
   * flag all come from the rate being edited now; only the DATE stays at today,
   * because saving writes the NEXT dated rate rather than overwriting this one.
   *
   * `current` only lands once the agent and category are picked and the history
   * has arrived, so this cannot be a useState initialiser — and it must not mark
   * the pairing seeded before `historyLoaded`, or it would latch onto nothing.
   * Keyed on the pairing so switching agent/category re-seeds, while values the
   * user has since typed on the SAME pairing are left alone.
   */
  const seededRateRef = useRef('');
  useEffect(() => {
    const key = `${agentName}|${pCategory.trim().toUpperCase()}`;
    if (!historyLoaded || !agentName || !pCategory.trim() || seededRateRef.current === key) return;
    seededRateRef.current = key;
    setRate(current ? String(current.ratePerUnit) : '');
    setAddToRate(current?.addToRate ?? false);
    if (current) setBasis(current.basis);
  }, [historyLoaded, agentName, pCategory, current]);

  const save = async () => {
    const agentId = agents.find((a) => a.name === agentName)?.id;
    if (!agentId) return toast.error('Choose an agent.');
    if (!pCategory.trim()) return toast.error('Choose a category.');
    if (!rate.trim()) return toast.error('Enter the rate.');
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0) return toast.error('Enter a valid rate — it cannot be negative.');
    const ceiling = basis === 'PCS' ? 500 : 5000;
    if (value > ceiling) return toast.error(`₹${value} per ${basisUnit(basis)} looks like a slipped decimal. The most that can be set is ₹${ceiling}.`);
    if (!effectiveFrom) return toast.error('Choose the date this rate takes effect.');
    const clash = past.find((h) => ymd(new Date(h.effectiveFrom)) === effectiveFrom);
    if (clash) {
      // Two rates on one date make "the rate in force" ambiguous, so the server
      // refuses it too. Say what to do instead of just refusing.
      return toast.error(
        `${agentName} already has a ${pCategory} rate of ₹${clash.ratePerUnit}/${basisUnit(clash.basis)} from ${effectiveFrom}.`,
        {
          description: 'Pick a different date to add the next rate, or delete that one in Rate history below to correct it.',
          duration: 9000,
        },
      );
    }
    if (value === 0) {
      const ok = await confirm({
        title: `Set ${pCategory.toUpperCase()} to zero commission?`,
        description: `${agentName} will earn nothing on ${pCategory.toUpperCase()} for invoices dated on or after ${effectiveFrom}.`,
        confirmText: 'Yes, zero',
      });
      if (!ok) return;
    }
    if (current && current.basis !== basis) {
      const ok = await confirm({
        title: `Change ${pCategory.toUpperCase()} from per ${basisUnit(current.basis)} to per ${basisUnit(basis)}?`,
        description: `That is a different quantity entirely — ${agentName}'s ${pCategory.toUpperCase()} commission would be measured a new way from ${effectiveFrom}.`,
        confirmText: `Charge per ${basisUnit(basis)}`,
        destructive: true,
      });
      if (!ok) return;
    }
    /*
     * Turning this on is a PRICE change for every party this agent sells the
     * category to — unlike the party-level Special Commission, a base rate
     * names nobody. Worth stopping for once, and only when it is being switched
     * on (or the amount changed while on); turning it off lowers prices back,
     * which needs no ceremony.
     */
    if (addToRate && !(current?.addToRate && current.ratePerUnit === value)) {
      const ok = await confirm({
        title: `Charge ₹${value}/${basisUnit(basis)} through to customers?`,
        description:
          `Every party ${agentName} sells ${pCategory.toUpperCase()} to will have ₹${value}/${basisUnit(basis)} added onto the ` +
          `product rate on new orders from ${effectiveFrom}. ${agentName} is still paid this at settlement exactly as before — ` +
          'this only changes what the customer is charged.',
        confirmText: 'Yes, add it to the price',
      });
      if (!ok) return;
    }
    create.mutate(
      { agentId, pCategory: pCategory.trim().toUpperCase(), basis, ratePerUnit: value, effectiveFrom, note: note.trim() || null, addToRate },
      {
        onSuccess: (saved) => {
          // Say what the save actually DID. "Saved" would leave the user
          // wondering whether the figures downstream had moved yet — which is
          // exactly the doubt the old re-price button existed to answer.
          const n = saved.repriced?.challans ?? 0;
          toast.success(
            `₹${value}/${basisUnit(basis)} set for ${agentName} · ${pCategory.toUpperCase()}` +
              (n ? ` — ${n} invoice${n === 1 ? '' : 's'} priced` : ' — no invoices in range yet'),
          );
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save the rate')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{seed ? `${seed.agentName} · ${seed.pCategory}` : 'Set a commission rate'}</DialogTitle>
          <DialogDescription>
            {current
              ? `Currently ₹${current.ratePerUnit}/${basisUnit(current.basis)} since ${formatDate(current.effectiveFrom)}. Saving adds a new dated rate — it does not overwrite this one.`
              : 'Nothing is priced here yet, so these invoices currently earn the agent nothing.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Agent</Label>
            <NativeSelect value={agentName} onChange={setAgentName} options={agents.map((a) => a.name)} placeholder="Select agent…" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Category</Label>
            <NativeSelect value={pCategory} onChange={pickCategory} options={allCategories} placeholder="Product category…" />
          </div>
        </div>

        {/* The three figures that ARE the rate, in one bordered block — they
            were a wrapping flex row where the ₹ box could end up beside the
            date on one line and under it on another. */}
        <div className="bg-muted/30 grid gap-3 rounded-lg border p-3 sm:grid-cols-[auto_1fr_auto]">
          <div className="space-y-1.5">
            <Label className="text-sm">Charge per</Label>
            <div className="bg-background flex h-10 items-center rounded-[4px] border p-0.5">
              {COMMISSION_BASES.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBasis(b)}
                  className={cn(
                    'h-full rounded-[3px] px-4 text-[13px] font-bold transition-colors',
                    basis === b ? 'bg-gradient-brand text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {b === 'PCS' ? 'Piece' : 'Kg'}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Rate per {basisUnit(basis)}</Label>
            {/* Spinners hidden: they invite nudging a price by ±1 with an
                accidental scroll, and a commission rate is typed, not dialled. */}
            <div className="relative">
              <IndianRupee className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                type="number"
                step="any"
                min={0}
                autoFocus
                className="h-10 pl-8 text-base font-bold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder={current ? String(current.ratePerUnit) : basis === 'PCS' ? '2' : '40'}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Effective from</Label>
            <Input type="date" className="h-10 w-full tabular-nums sm:w-44" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
        </div>

        {/*
          * Charge it through to the customer, or absorb it.
          *
          * The same switch the party-level Special Commission carries, and the
          * copy has to say what is different about this one: a base rate names
          * no party, so ON reaches EVERY party this agent sells the category to.
          */}
        <label
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
            addToRate
              ? 'border-amber-300 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-400/10'
              : 'hover:bg-muted/40',
          )}
        >
          <Switch checked={addToRate} onCheckedChange={setAddToRate} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Receipt className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              Add this rate to the product price
            </span>
            <span className="text-muted-foreground mt-0.5 block text-[11.5px] leading-snug">
              {addToRate ? (
                <>
                  {/* The box starts empty on a new dated rate, and "₹—/kg" reads
                      like a broken figure — name the amount only once there is one. */}
                  {rate.trim() ? `₹${rate}/${basisUnit(basis)} is` : 'This rate is'} added onto the product rate on new orders,
                  so the customer pays it. {agentName || 'The agent'} is still paid it at settlement exactly as before.
                </>
              ) : (
                <>
                  Off (usual): {agentName || 'the agent'} is paid this out of margin at settlement — customers’ prices are
                  untouched. Turn on to charge it through instead.
                </>
              )}
            </span>
            {addToRate && (
              <span className="mt-1.5 flex items-start gap-1.5 text-[11.5px] font-semibold text-amber-800 dark:text-amber-300">
                <Users className="mt-[1px] size-3.5 shrink-0" />
                This is the base rate, so it applies to EVERY party {agentName || 'this agent'} sells{' '}
                {pCategory ? pCategory.toUpperCase() : 'this category'} to. For one party only, use Special Commission.
              </span>
            )}
          </span>
        </label>

        {/* The consequence of that date, in invoices. */}
        {!!impact.data && !!pCategory.trim() && (
          <p
            className={cn(
              'rounded-[4px] px-2.5 py-1.5 text-[12px]',
              impact.data.onOrAfter === 0
                ? 'bg-rose-50 font-semibold text-rose-800 dark:bg-rose-500/10 dark:text-rose-300'
                : 'text-muted-foreground',
            )}
          >
            {impact.data.onOrAfter === 0 ? (
              <>
                No {pCategory.toUpperCase()} invoices for {agentName} are dated on or after {formatDate(effectiveFrom)}, so this
                rate would price <b>nothing</b>.
                {impact.data.earliestInvDate && (
                  <>
                    {' '}
                    Their earliest is <b>{formatDate(impact.data.earliestInvDate)}</b> — set the date to that to price all{' '}
                    {impact.data.before} of them.
                  </>
                )}
              </>
            ) : (
              <>
                Prices <b>{impact.data.onOrAfter}</b> {pCategory.toUpperCase()} invoice{impact.data.onOrAfter === 1 ? '' : 's'} as
                soon as you save
                {impact.data.before > 0 && (
                  <>
                    ; {impact.data.before} earlier {impact.data.before === 1 ? 'one keeps' : 'ones keep'} whatever rate applied on{' '}
                    {impact.data.before === 1 ? 'its' : 'their'} own date
                  </>
                )}
                .
              </>
            )}
          </p>
        )}

        {pCategory && suggested && (
          <p className={cn('rounded-[4px] px-2.5 py-1.5 text-[12px]', overridden ? 'bg-amber-50 font-semibold text-amber-800' : 'text-muted-foreground')}>
            {overridden
              ? `${pCategory.toUpperCase()} is sold by ${suggested === 'PCS' ? 'piece' : 'weight'} — you are paying commission per ${basisUnit(basis)} instead. Only do this deliberately.`
              : `${pCategory.toUpperCase()} is sold by ${suggested === 'PCS' ? 'piece' : 'weight'}, so commission is charged per ${basisUnit(basis)} to match.`}
          </p>
        )}

        <div className="space-y-1.5">
          <Label className="text-sm">Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — why it changed" />
        </div>

        {/* The dated history, where it belongs: beside the thing being changed. */}
        {past.length > 0 && (
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
              <History className="size-3.5" /> Rate history
            </div>
            <ul className="max-h-32 space-y-0.5 overflow-auto rounded-[4px] border p-1.5">
              {past.map((h) => (
                <li key={h.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-muted/50">
                  <span className="font-bold tabular-nums text-emerald-700">
                    ₹{num(h.ratePerUnit)}
                    <span className="text-muted-foreground text-[9.5px] font-semibold">/{basisUnit(h.basis)}</span>
                  </span>
                  <span className="tabular-nums">{formatDate(h.effectiveFrom)}</span>
                  {h.current && (
                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      current
                    </span>
                  )}
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">{h.note}</span>
                  {can('agentcommission:update') && (
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Remove this rate?',
                          description: `${h.agentName} · ${h.pCategory} · ₹${h.ratePerUnit}/${basisUnit(h.basis)} from ${formatDate(h.effectiveFrom)}. Invoices already priced on it keep their commission until you re-price.`,
                          confirmText: 'Remove',
                          destructive: true,
                        });
                        if (!ok) return;
                        del.mutate(h.id, {
                          onSuccess: (r) => {
                            const n = r?.repriced?.challans ?? 0;
                            toast.success(n ? `Rate removed — ${n} invoice${n === 1 ? '' : 's'} re-priced` : 'Rate removed');
                          },
                          onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
                        });
                      }}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-6 shrink-0 items-center justify-center rounded-[4px]"
                      aria-label={`Remove the ₹${h.ratePerUnit} rate from ${formatDate(h.effectiveFrom)}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : current ? <Pencil /> : <Plus />} {current ? 'Save new rate' : 'Set rate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
