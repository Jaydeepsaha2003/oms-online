import { useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock, Layers, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  basisUnit,
  SPECIAL_COMMISSION_SCOPE_LABEL,
  specialCommissionLabel,
  type AgentCommissionRateDto,
  type AgentSpecialCommissionDto,
  type CommissionBasis,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  useCommissionRates,
  useDeleteCommissionRate,
  useDeleteSpecialCommission,
  useSpecialCommissions,
} from './use-agent-commission';

const TH =
  'sticky top-0 border-b bg-gradient-to-b from-blue-800 to-indigo-800 px-2.5 py-2 text-left text-[10.5px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap';
const TD = 'px-2.5 py-1.5 align-middle';

/** Where a rate sits in time — not the same question as "is it current". */
type Standing = 'IN_FORCE' | 'SUPERSEDED' | 'SCHEDULED';

const STANDING: Record<Standing, { label: string; chip: string; Icon: typeof Clock }> = {
  IN_FORCE: {
    label: 'In force',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300',
    Icon: CheckCircle2,
  },
  SCHEDULED: {
    label: 'Scheduled',
    chip: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300',
    Icon: CalendarClock,
  },
  SUPERSEDED: {
    label: 'Superseded',
    chip: 'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-white/10 dark:text-slate-400',
    Icon: Clock,
  },
};

/** One rate of either kind, flattened so both can share a register. */
interface Row {
  key: string;
  id: number;
  kind: 'BASE' | 'SPECIAL';
  agentName: string;
  /** What it is aimed at, in words. */
  appliesTo: string;
  /** The party, or null for "all parties". */
  party: string | null;
  pCategory: string | null;
  basis: CommissionBasis;
  ratePerUnit: number;
  effectiveFrom: string;
  standing: Standing;
  note: string | null;
  /** Scope chip text for a special; null for a base rate. */
  scopeLabel: string | null;
}

/**
 * Every rate that exists — base and special, in force, scheduled and past.
 *
 * The other two tabs are working views: Base rates shows one row per pairing (the
 * rate in force, and the gaps), and Special commission shows the exceptions. So
 * neither can answer "what have we ever agreed with this agent?" — the superseded
 * rows are exactly what they filter out, and those are the rows that explain a
 * settlement paid six months ago.
 *
 * Read-only apart from delete, which is the one action that belongs to a rate
 * rather than to a pairing.
 */
export function AllRatesPanel() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const canEdit = can('agentcommission:update');

  const { data: base, isLoading: loadingBase } = useCommissionRates();
  const { data: specials, isLoading: loadingSpecial } = useSpecialCommissions();
  const delBase = useDeleteCommissionRate();
  const delSpecial = useDeleteSpecialCommission();
  const busy = delBase.isPending || delSpecial.isPending;

  const [agent, setAgent] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState<'' | 'BASE' | 'SPECIAL'>('');
  const [standing, setStanding] = useState<'' | Standing>('');

  // A future-dated rate is NOT superseded — it simply has not started. The
  // `current` flag alone cannot tell those apart, and calling a scheduled rate
  // "superseded" would read as "already replaced", the opposite of the truth.
  const standingOf = (effectiveFrom: string, current: boolean): Standing =>
    new Date(effectiveFrom) > new Date() ? 'SCHEDULED' : current ? 'IN_FORCE' : 'SUPERSEDED';

  const rows = useMemo<Row[]>(() => {
    const fromBase = (r: AgentCommissionRateDto): Row => ({
      key: `B${r.id}`,
      id: r.id,
      kind: 'BASE',
      agentName: r.agentName,
      appliesTo: r.pCategory,
      party: null,
      pCategory: r.pCategory,
      basis: r.basis,
      ratePerUnit: r.ratePerUnit,
      effectiveFrom: r.effectiveFrom,
      standing: standingOf(r.effectiveFrom, r.current),
      note: r.note,
      scopeLabel: null,
    });
    const fromSpecial = (r: AgentSpecialCommissionDto): Row => ({
      key: `S${r.id}`,
      id: r.id,
      kind: 'SPECIAL',
      agentName: r.agentName,
      // The same one-line description the pricing engine writes into an
      // accrual's note, so a figure and this list read identically.
      appliesTo: specialCommissionLabel(r),
      party: r.customerName,
      pCategory: r.pCategory,
      basis: r.basis,
      ratePerUnit: r.ratePerUnit,
      effectiveFrom: r.effectiveFrom,
      standing: standingOf(r.effectiveFrom, r.current),
      note: r.note,
      scopeLabel: SPECIAL_COMMISSION_SCOPE_LABEL[r.scope],
    });

    return [...(base ?? []).map(fromBase), ...(specials ?? []).map(fromSpecial)].sort(
      (a, b) =>
        a.agentName.localeCompare(b.agentName) ||
        (a.pCategory ?? '').localeCompare(b.pCategory ?? '') ||
        // Newest first within a pairing: the rate in force sits above the
        // history that led to it.
        +new Date(b.effectiveFrom) - +new Date(a.effectiveFrom),
    );
  }, [base, specials]);

  const agents = useMemo(() => [...new Set(rows.map((r) => r.agentName))].sort(), [rows]);
  const categories = useMemo(() => [...new Set(rows.map((r) => r.pCategory).filter((c): c is string => !!c))].sort(), [rows]);

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!agent || r.agentName === agent) &&
          (!category || r.pCategory === category) &&
          (!kind || r.kind === kind) &&
          (!standing || r.standing === standing),
      ),
    [rows, agent, category, kind, standing],
  );

  const counts = useMemo(
    () => ({
      inForce: rows.filter((r) => r.standing === 'IN_FORCE').length,
      scheduled: rows.filter((r) => r.standing === 'SCHEDULED').length,
      superseded: rows.filter((r) => r.standing === 'SUPERSEDED').length,
      special: rows.filter((r) => r.kind === 'SPECIAL').length,
    }),
    [rows],
  );

  const remove = async (r: Row) => {
    const ok = await confirm({
      title: 'Remove this rate?',
      description:
        `${r.agentName} — ${r.appliesTo} at ₹${r.ratePerUnit}/${basisUnit(r.basis)} from ${formatDate(r.effectiveFrom)}. ` +
        (r.standing === 'SUPERSEDED'
          ? 'It is already superseded, so invoices priced on it keep their figures — but the history of why they were priced that way goes with it.'
          : 'Invoices will re-price to the next matching rule, or to the base rate.'),
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const opts = {
      onSuccess: (res: { repriced?: { challans: number } } | void) => {
        const n = res?.repriced?.challans ?? 0;
        toast.success(n ? `Rate removed — ${n} invoice${n === 1 ? '' : 's'} re-priced` : 'Rate removed');
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Could not remove the rate')),
    };
    if (r.kind === 'BASE') delBase.mutate(r.id, opts);
    else delSpecial.mutate(r.id, opts);
  };

  const loading = loadingBase || loadingSpecial;

  return (
    <div className="space-y-3">
      {/* ── What the book holds ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile label="In force" value={counts.inForce} tone="emerald" hint="pricing invoices today" />
        <Tile label="Scheduled" value={counts.scheduled} tone="sky" hint="start on a future date" />
        <Tile label="Superseded" value={counts.superseded} tone="slate" hint="kept, still explain old invoices" />
        <Tile label="Special" value={counts.special} tone="indigo" hint="party / product / design" />
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="bg-card grid grid-cols-2 items-end gap-2 rounded-[4px] border p-2.5 shadow-sm sm:flex sm:flex-wrap sm:gap-3">
        <Field label="Agent">
          <NativeSelect value={agent} onChange={setAgent} options={['', ...agents]} placeholder="All agents" />
        </Field>
        <Field label="Category">
          <NativeSelect value={category} onChange={setCategory} options={['', ...categories]} placeholder="All categories" />
        </Field>
        <Field label="Kind">
          <NativeSelect
            value={kind}
            onChange={(v) => setKind(v as '' | 'BASE' | 'SPECIAL')}
            options={[
              { value: '', label: 'Base + special' },
              { value: 'BASE', label: 'Base only' },
              { value: 'SPECIAL', label: 'Special only' },
            ]}
          />
        </Field>
        <Field label="Standing">
          <NativeSelect
            value={standing}
            onChange={(v) => setStanding(v as '' | Standing)}
            options={[
              { value: '', label: 'Any' },
              { value: 'IN_FORCE', label: 'In force' },
              { value: 'SCHEDULED', label: 'Scheduled' },
              { value: 'SUPERSEDED', label: 'Superseded' },
            ]}
          />
        </Field>
      </div>

      {/* ── The register ────────────────────────────────────────────────── */}
      <div className="bg-card flex flex-col overflow-hidden rounded-[6px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-x-2 border-b bg-slate-50/80 px-3 py-2 dark:bg-white/[0.03]">
          <span className="text-[12.5px] font-bold">All rates</span>
          <span className="text-muted-foreground text-[11.5px]">
            {shown.length} of {rows.length} · every rate ever set, newest first per pairing
          </span>
        </div>

        <div className="max-h-[min(60vh,38rem)] overflow-auto">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : !shown.length ? (
            <div className="text-muted-foreground px-4 py-12 text-center text-[13px]">
              {rows.length ? 'No rates match these filters.' : 'No rates have been set yet.'}
            </div>
          ) : (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className={cn(TH, 'w-10 text-center')}>#</th>
                  <th className={cn(TH, 'w-20')}>Kind</th>
                  <th className={TH}>Agent</th>
                  <th className={TH}>Applies to</th>
                  <th className={TH}>Party</th>
                  <th className={cn(TH, 'text-right')}>Rate</th>
                  <th className={TH}>Effective from</th>
                  <th className={cn(TH, 'text-center')}>Standing</th>
                  <th className={TH}>Note</th>
                  {canEdit && <th className={cn(TH, 'w-12 text-center')} />}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const st = STANDING[r.standing];
                  return (
                    <tr
                      key={r.key}
                      className={cn(
                        'border-b transition-colors hover:bg-indigo-50/60 dark:hover:bg-white/[0.04]',
                        // Past rates recede: they are reference, not the answer
                        // to "what do we pay now".
                        r.standing === 'SUPERSEDED' ? 'text-muted-foreground bg-slate-50/60 dark:bg-white/[0.02]' : 'odd:bg-slate-50/40 dark:odd:bg-white/[0.015]',
                      )}
                    >
                      <td className={cn(TD, 'text-muted-foreground text-center tabular-nums')}>{i + 1}</td>
                      <td className={TD}>
                        {r.kind === 'BASE' ? (
                          <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold dark:bg-white/10">BASE</span>
                        ) : (
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300">
                            {r.scopeLabel}
                          </span>
                        )}
                      </td>
                      <td className={cn(TD, 'font-bold whitespace-nowrap')}>{r.agentName}</td>
                      <td className={cn(TD, 'font-semibold')}>{r.appliesTo}</td>
                      <td className={TD}>{r.party ?? <span className="text-muted-foreground">All parties</span>}</td>
                      <td className={cn(TD, 'text-right font-bold tabular-nums whitespace-nowrap')}>
                        ₹{r.ratePerUnit}
                        <span className="text-muted-foreground text-[10px] font-normal">/{basisUnit(r.basis)}</span>
                      </td>
                      <td className={cn(TD, 'tabular-nums whitespace-nowrap')}>{formatDate(r.effectiveFrom)}</td>
                      <td className={cn(TD, 'text-center')}>
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset', st.chip)}>
                          <st.Icon className="size-3" /> {st.label}
                        </span>
                      </td>
                      <td className={cn(TD, 'text-muted-foreground max-w-[16rem] truncate')} title={r.note ?? undefined}>
                        {r.note ?? ''}
                      </td>
                      {canEdit && (
                        <td className={cn(TD, 'text-center')}>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(r)} disabled={busy} aria-label="Remove rate">
                            <Trash2 className="size-3.5 text-rose-600" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-muted-foreground border-t px-3 py-1.5 text-[11.5px]">
          Superseded rates are kept on purpose — an invoice prices at the rate in force on its own invoice date, so the old rows
          are what explain a settlement paid months ago. Deleting one is refused once a settlement covering its dates has been paid.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="w-full min-w-0 space-y-1 sm:w-44">
      <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">{label}</Label>
      {children}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'sky' | 'slate' | 'indigo';
  hint: string;
}) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    sky: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-300',
    slate: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-500/10 dark:text-indigo-300',
  } as const;
  return (
    <div className={cn('rounded-[4px] border px-3 py-2 shadow-sm', tones[tone])}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase opacity-80">
        <Layers className="size-3.5" />
        {label}
      </div>
      <div className="text-[22px] leading-tight font-extrabold tabular-nums">{value.toLocaleString('en-IN')}</div>
      <div className="text-[10.5px] font-medium opacity-80">{hint}</div>
    </div>
  );
}
