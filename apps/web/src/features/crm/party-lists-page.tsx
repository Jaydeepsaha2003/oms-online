import { useMemo, useState, type CSSProperties } from 'react';
import { CheckCircle2, Loader2, Pencil, Plus, Search, Shield, ShieldAlert, ShieldCheck, Trash2, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  matchPartyCondition,
  matchPartyList,
  OPERATORS_FOR_TYPE,
  PARTY_METRIC_META,
  type PartyClassRow,
  type PartyCondition,
  type PartyListDef,
  type PartyListKind,
  type PartyListOperator,
  type PartyMetricKey,
  type PartyMetrics,
  type PartyMetricType,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useConfirm } from '@/components/common/confirm';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { NativeSelect } from '@/components/common/combo';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { usePartyListsEvaluate, useSavePartyListsConfig } from './use-party-lists';
import { initials } from './crm-shared';

/*
 * CRM · Party Lists, in the Party Lists mockup's design (index.css `.pls-*`,
 * over the Party Ledger's `.pl-*` pieces): the list totals on a blue header,
 * one card per list, and every party under list tabs — a sortable grid on
 * desktop, cards on a phone. Membership is the server's; the editor counts its
 * live matches with the same shared rule (`matchPartyList`), so the preview is
 * the membership the list will have once saved.
 */

const META_BY_KEY = new Map(PARTY_METRIC_META.map((m) => [m.key, m]));
const typeOf = (k: PartyMetricKey): PartyMetricType => META_BY_KEY.get(k)?.type ?? 'number';
const OP_LABEL: Record<PartyListOperator, string> = {
  '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': 'is', '!=': 'is not', contains: 'contains', notContains: "doesn't contain",
};
const UNIT: Partial<Record<PartyMetricType, string>> = { money: '₹', percent: '%', days: 'd' };

/** Each kind's colours — the mockup's gradients, dots and chip tones. */
const KIND: Record<PartyListKind, { label: string; bar: string; head: string; icon: string; dot: string; chip: string; num: string; Icon: LucideIcon }> = {
  GREEN: {
    label: 'Green', bar: 'linear-gradient(90deg,#34d399,#059669)', head: 'linear-gradient(135deg,#10b981,#047857)',
    icon: 'linear-gradient(135deg,#34d399,#059669)', dot: '#10b981', chip: 'pl-tone-emerald', num: 'text-[#047857] dark:text-emerald-400', Icon: ShieldCheck,
  },
  BLACK: {
    label: 'Black', bar: 'linear-gradient(90deg,#475569,#0f172a)', head: 'linear-gradient(135deg,#334155,#0f172a)',
    icon: 'linear-gradient(135deg,#475569,#0f172a)', dot: '#0f172a', chip: 'pls-tone-black', num: 'text-[#0f172a] dark:text-slate-200', Icon: ShieldAlert,
  },
  CUSTOM: {
    label: 'Custom', bar: 'linear-gradient(90deg,#a78bfa,#7c3aed)', head: 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
    icon: 'linear-gradient(135deg,#a78bfa,#7c3aed)', dot: '#8b5cf6', chip: 'pls-tone-violet', num: 'text-[#6d28d9] dark:text-violet-300', Icon: Shield,
  },
};
/** "Green — Trusted payers" → "Green", for tabs and chips. */
const shortName = (name: string) => name.split('—')[0].trim();

const fmtMetric = (k: PartyMetricKey, v: number | string | boolean | null): string => {
  if (v == null) return '—';
  const t = typeOf(k);
  if (t === 'money') return inrCompact(Number(v));
  if (t === 'percent') return `${v}%`;
  if (t === 'days') return `${v}d`;
  if (t === 'bool') return v ? 'Yes' : 'No';
  return String(v);
};
/** A condition as a chip: "Days past credit period ≥ 15d". */
const condText = (c: PartyCondition) => {
  const t = typeOf(c.field);
  const v =
    t === 'money' ? inrCompact(Number(c.value)) : t === 'percent' ? `${c.value}%` : t === 'days' ? `${c.value}d` : t === 'bool' ? (String(c.value) === 'true' ? 'Yes' : 'No') : t === 'number' ? String(c.value) : `“${c.value}”`;
  return `${META_BY_KEY.get(c.field)?.label ?? c.field} ${OP_LABEL[c.op]} ${v}`;
};
/** Numbers as numbers and text / yes-no as text — what the server stores. */
const normalized = (c: PartyCondition): PartyCondition => ({
  field: c.field,
  op: c.op,
  value: typeOf(c.field) === 'text' || typeOf(c.field) === 'bool' ? String(c.value) : c.value === '' ? '' : Number(c.value),
});

/** Where a party stands, for its rail and avatar: old overdue, any trouble, or fine. */
type Standing = 'rose' | 'amber' | 'emerald';
const standingOf = (m: PartyMetrics): Standing => (m.overdue > 0 && m.oldestOverdueDays >= 60 ? 'rose' : m.overdue > 0 || m.brokenPromises > 0 ? 'amber' : 'emerald');
const STANDING: Record<Standing, { av: string; rail: string; dot: string; label: string }> = {
  rose: { av: 'bg-[#fff1f2] text-[#be123c] ring-1 ring-[#fecdd3] dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/30', rail: 'linear-gradient(180deg,#fb7185,#e11d48)', dot: '#be123c', label: 'High risk' },
  amber: { av: 'bg-[#fffbeb] text-[#b45309] ring-1 ring-[#fde68a] dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30', rail: 'linear-gradient(180deg,#fcd34d,#f59e0b)', dot: '#b45309', label: 'Watch' },
  emerald: { av: 'bg-[#ecfdf5] text-[#047857] ring-1 ring-[#a7f3d0] dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30', rail: 'linear-gradient(180deg,#6ee7b7,#10b981)', dot: '#047857', label: 'Healthy' },
};

export function PartyListsPage() {
  const { can } = usePermissions();
  const canEdit = can('crm:update');
  const { data: evalData, isLoading } = usePartyListsEvaluate();
  const lists = evalData?.lists ?? [];
  const parties = evalData?.parties ?? [];

  const [tab, setTab] = useState<string>('all'); // 'all' | 'unclassified' | listId
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PartyListDef | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);

  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const counts = useMemo(() => {
    const m = new Map<string, { members: number; outstanding: number }>();
    for (const l of lists) m.set(l.id, { members: 0, outstanding: 0 });
    let unclassified = 0;
    const byKind: Record<PartyListKind, { n: number; outstanding: number }> = { GREEN: { n: 0, outstanding: 0 }, BLACK: { n: 0, outstanding: 0 }, CUSTOM: { n: 0, outstanding: 0 } };
    for (const p of parties) {
      if (p.matched.length === 0) unclassified += 1;
      for (const id of p.matched) {
        const c = m.get(id);
        if (c) (c.members += 1), (c.outstanding += p.metrics.outstanding);
      }
      // A party in two green lists is still one green-listed party.
      for (const kind of new Set(p.matched.map((id) => listById.get(id)?.kind).filter(Boolean) as PartyListKind[])) {
        byKind[kind].n += 1;
        byKind[kind].outstanding += p.metrics.outstanding;
      }
    }
    return { m, unclassified, byKind };
  }, [lists, parties, listById]);

  const filtered = useMemo(() => {
    let rows = parties;
    if (tab === 'unclassified') rows = rows.filter((p) => p.matched.length === 0);
    else if (tab !== 'all') rows = rows.filter((p) => p.matched.includes(tab));
    const s = search.trim().toLowerCase();
    if (s) rows = rows.filter((p) => p.party.toLowerCase().includes(s) || (p.metrics.agent ?? '').toLowerCase().includes(s));
    return rows;
  }, [parties, tab, search]);

  const openNew = () => {
    setEditing(null);
    setBuilderOpen(true);
  };
  const openEdit = (l: PartyListDef) => {
    setEditing(l);
    setBuilderOpen(true);
  };

  const heroTiles = [
    { label: 'Green-listed', value: counts.byKind.GREEN.n, hint: 'trusted payers', dot: '#6ee7b7' },
    { label: 'Black-listed', value: counts.byKind.BLACK.n, hint: `${inrCompact(counts.byKind.BLACK.outstanding)} outstanding`, dot: '#1e293b' },
    { label: 'Custom lists', value: counts.byKind.CUSTOM.n, hint: 'parties in any custom list', dot: '#c4b5fd' },
    { label: 'Unlisted', value: counts.unclassified, hint: 'match no list', dot: '#fcd34d' },
  ];

  return (
    <div className="pls-page flex flex-col gap-3.5">
      <div className="pls-backdrop" aria-hidden />

      {/* ── The blue header: how many parties, and where they fall ── */}
      <section className="pls-hero">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[12px] font-bold tracking-[0.04em] text-white/80">CRM · Party lists</span>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[40px] leading-none font-extrabold tracking-[-0.03em] tabular-nums">{isLoading ? '—' : parties.length}</span>
              <span className="text-[15px] font-bold text-white/90">parties classified</span>
              <span className="rounded-full bg-white/95 px-[11px] py-[4px] text-[12px] font-extrabold text-[#2f3fb5]">
                {lists.length} list{lists.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] text-white/80">Green-list your best payers, black-list the risky ones, using your own conditions.</p>
          </div>
          {canEdit && (
            <button type="button" className="pls-hbtn" onClick={openNew}>
              <Plus className="size-4" /> New list
            </button>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          {heroTiles.map((t) => (
            <div key={t.label} className="pls-htile">
              <div className="pls-htile-label">
                <span className="size-2 shrink-0 rounded-full" style={{ background: t.dot, boxShadow: '0 0 0 2px rgba(255,255,255,.35)' }} />
                {t.label}
              </div>
              <div className="mt-0.5 text-[22px] font-extrabold tabular-nums">{isLoading ? '—' : t.value}</div>
              <div className="truncate text-[11.5px] text-white/75">{t.hint}</div>
            </div>
          ))}
        </div>
      </section>

      {isLoading ? (
        <div className="pl-muted flex items-center justify-center gap-2 py-16 text-sm">
          <Loader2 className="size-4 animate-spin" /> Evaluating parties…
        </div>
      ) : (
        <>
          {/* ── One card per list — auto-fit, so however many lists there are
              they share the full width instead of leaving empty columns. ── */}
          <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
            {lists.map((l, i) => {
              const k = KIND[l.kind];
              const c = counts.m.get(l.id) ?? { members: 0, outstanding: 0 };
              const on = tab === l.id;
              return (
                <div
                  key={l.id}
                  className="pls-card flex flex-col gap-3 p-4 pt-5"
                  data-on={on}
                  data-off={!l.enabled}
                  style={{ '--bar': k.bar, animationDelay: `${i * 60}ms` } as CSSProperties}
                >
                  <div className="flex items-start gap-3">
                    <span className="pls-icon" style={{ '--icon': k.icon, '--dot': k.dot } as CSSProperties}>
                      <k.Icon className="size-[18px]" />
                    </span>
                    {/* The card is its own tab: pick it to see just its parties. */}
                    <button type="button" onClick={() => setTab(on ? 'all' : l.id)} className="min-w-0 flex-1 cursor-pointer text-left" aria-pressed={on}>
                      <span className="flex items-center gap-2 text-[15px] leading-tight font-extrabold">
                        <span className="truncate">{l.name}</span>
                        {!l.enabled && <span className="pl-chip pl-tone-indigo shrink-0 px-2 text-[10.5px]">Off</span>}
                      </span>
                      <span className="pl-muted mt-0.5 block truncate text-[12px]">{l.description || 'No description'}</span>
                    </button>
                    {canEdit && (
                      <button type="button" onClick={() => openEdit(l)} className="pl-eye shrink-0" aria-label={`Edit ${l.name}`} title="Edit list">
                        <Pencil className="size-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div className="flex items-baseline gap-1.5">
                      <span className={cn('text-[30px] leading-none font-extrabold tabular-nums', k.num)}>{c.members}</span>
                      <span className="pl-muted text-[12px] font-semibold">parties</span>
                    </div>
                    <div className="flex items-baseline gap-1.5" title={inrFull(c.outstanding)}>
                      <span className="text-[16px] font-extrabold tabular-nums">{inrCompact(c.outstanding)}</span>
                      <span className="pl-muted text-[12px] font-semibold">outstanding</span>
                    </div>
                  </div>
                  <span className="pl-kpi-track mt-0" role="img" aria-label={`${c.members} of ${parties.length} parties`}>
                    <span style={{ width: `${parties.length ? (c.members / parties.length) * 100 : 0}%`, background: k.bar }} />
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="pl-chip pl-tone-indigo px-2 text-[11px]">Match {l.match}</span>
                    {l.conditions.map((cond, j) => (
                      <span key={j} className="pls-cond">
                        {condText(cond)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {canEdit && (
              <button type="button" className="pls-new flex flex-col items-center justify-center gap-2.5" onClick={openNew}>
                <span className="pls-new-plus">
                  <Plus className="size-5" />
                </span>
                Create a new list
              </button>
            )}
          </section>

          {/* ── The parties, under list tabs ── */}
          <section className="pl-ledger overflow-hidden">
            <div className="pls-toolbar flex flex-wrap items-center gap-2.5 px-3 py-2.5">
              <div className="rp-noscroll flex max-w-full gap-1.5 overflow-x-auto max-sm:w-full">
                <TabBtn on={tab === 'all'} onClick={() => setTab('all')} label="All" count={parties.length} />
                {lists.map((l) => (
                  <TabBtn key={l.id} on={tab === l.id} onClick={() => setTab(l.id)} label={shortName(l.name)} count={counts.m.get(l.id)?.members ?? 0} dot={KIND[l.kind].dot} />
                ))}
                <TabBtn on={tab === 'unclassified'} onClick={() => setTab('unclassified')} label="Unlisted" count={counts.unclassified} dot="#cbd5e1" />
              </div>
              <label className="pls-search ml-auto w-full sm:w-[300px]">
                <span className="sr-only">Search party or agent</span>
                <Search className="pl-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <input placeholder="Search party or agent…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
            </div>
            <PartyTable rows={filtered} listById={listById} />
          </section>
        </>
      )}

      {builderOpen && <ListBuilder lists={lists} parties={parties} editing={editing} onClose={() => setBuilderOpen(false)} />}
    </div>
  );
}

function TabBtn({ on, onClick, label, count, dot }: { on: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="pls-tab">
      {dot && <span className="size-2 shrink-0 rounded-full" style={{ background: dot, boxShadow: on ? '0 0 0 2px rgba(255,255,255,.6)' : undefined }} />}
      {label}
      <span className="pls-tab-n">{count}</span>
    </button>
  );
}

/* ── The parties ─────────────────────────────────────────────────────────────── */

/** The grid's figures, in order. Days past credit sits beside the oldest overdue
 *  so a party put on a list by the credit-period rule shows why. */
const TABLE_METRICS: PartyMetricKey[] = ['outstanding', 'overdue', 'oldestOverdueDays', 'daysPastCredit', 'lifetimeRevenue', 'collectionRate', 'avgPaymentDays', 'brokenPromises'];
/** The same figures on a phone card, where a column is a third of the screen. */
const SHORT_LABEL: Partial<Record<PartyMetricKey, string>> = {
  outstanding: 'Outstanding', overdue: 'Overdue', oldestOverdueDays: 'Oldest due', daysPastCredit: 'Past credit',
  lifetimeRevenue: 'Revenue', collectionRate: 'Collected', avgPaymentDays: 'Avg pay', brokenPromises: 'Broken',
};
type Level = 'ok' | 'warn' | 'bad';
const LEVEL_CHIP: Record<Level, string> = { ok: 'pl-tone-emerald', warn: 'pls-tone-amber', bad: 'pl-tone-rose' };
const LEVEL_BAR: Record<Level, string> = {
  ok: 'linear-gradient(90deg,#6ee7b7,#10b981)',
  warn: 'linear-gradient(90deg,#fcd34d,#f59e0b)',
  bad: 'linear-gradient(90deg,#fb7185,#e11d48)',
};
const LEVEL_TEXT: Record<Level, string> = { ok: 'text-[#047857] dark:text-emerald-400', warn: 'text-[#b45309] dark:text-amber-400', bad: 'text-[#be123c] dark:text-rose-400' };

/** One figure, drawn the way the mockup draws that kind of figure: a bar behind
 *  money, a toned chip for days and promises, a toned bar for the collection rate. */
function MetricCell({ k, p, maxOut, maxRev }: { k: PartyMetricKey; p: PartyClassRow; maxOut: number; maxRev: number }) {
  const m = p.metrics;
  const v = (m as unknown as Record<string, number | null>)[k];
  const title = typeOf(k) === 'money' && v != null ? inrFull(Number(v)) : k === 'daysPastCredit' && m.creditPeriod != null ? `Credit period ${m.creditPeriod} days` : undefined;
  const bar = (w: number, bg: string) => (
    <span className="pls-mbar">
      <span style={{ width: `${Math.max(0, Math.min(100, w))}%`, background: bg }} />
    </span>
  );
  if (v == null) return <span className="text-[#c3c9d6] dark:text-slate-600">—</span>;
  const n = Number(v);
  switch (k) {
    case 'outstanding':
      return (
        <span title={title}>
          <span className="font-extrabold">{fmtMetric(k, n)}</span>
          {bar((n / maxOut) * 100, 'linear-gradient(90deg,#8ea0f8,#3b4fd8)')}
        </span>
      );
    case 'lifetimeRevenue':
      return (
        <span title={title}>
          <span className="font-bold text-[#3a4256] dark:text-slate-300">{fmtMetric(k, n)}</span>
          {bar((n / maxRev) * 100, 'linear-gradient(90deg,#c4b5fd,#7c3aed)')}
        </span>
      );
    case 'overdue':
      return n > 0 ? (
        <span title={title}>
          <span className="font-extrabold text-[#be123c] dark:text-rose-400">{fmtMetric(k, n)}</span>
          {bar((n / (m.outstanding || 1)) * 100, 'linear-gradient(90deg,#fb7185,#e11d48)')}
        </span>
      ) : (
        <span className="font-bold text-[#047857] dark:text-emerald-400">Nil</span>
      );
    case 'collectionRate': {
      const lvl: Level = n >= 90 ? 'ok' : n >= 70 ? 'warn' : 'bad';
      return (
        <span>
          <span className={cn('font-extrabold', LEVEL_TEXT[lvl])}>{fmtMetric(k, n)}</span>
          {bar(n, LEVEL_BAR[lvl])}
        </span>
      );
    }
    case 'oldestOverdueDays':
    case 'daysPastCredit':
    case 'avgPaymentDays': {
      if (k !== 'avgPaymentDays' && n <= 0) return <span className="text-[#c3c9d6] dark:text-slate-600" title={title}>—</span>;
      const lvl: Level =
        k === 'avgPaymentDays' ? (n > 45 ? 'bad' : n > 30 ? 'warn' : 'ok') : k === 'oldestOverdueDays' ? (n >= 60 ? 'bad' : n >= 30 ? 'warn' : 'ok') : n >= 30 ? 'bad' : 'warn';
      return (
        <span className={cn('pl-chip px-2 text-[12.5px]', LEVEL_CHIP[lvl])} title={title}>
          {fmtMetric(k, n)}
        </span>
      );
    }
    case 'brokenPromises':
      return n ? <span className={cn('pl-chip px-2 text-[12.5px]', LEVEL_CHIP[n >= 3 ? 'bad' : 'warn'])}>{n}</span> : <span className="font-semibold text-[#94a3b8]">0</span>;
    default:
      return <span className="font-bold">{fmtMetric(k, n)}</span>;
  }
}

function ListChips({ p, listById }: { p: PartyClassRow; listById: Map<string, PartyListDef> }) {
  if (!p.matched.length) return <span className="pl-muted text-[11px] font-semibold">Unlisted</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {p.matched.map((id) => {
        const l = listById.get(id);
        if (!l) return null;
        return (
          <span key={id} className={cn('pl-chip gap-1 px-2 text-[11px]', KIND[l.kind].chip)}>
            <span className="size-1.5 rounded-full" style={{ background: l.kind === 'BLACK' ? '#fff' : KIND[l.kind].dot }} />
            {shortName(l.name)}
          </span>
        );
      })}
    </span>
  );
}

type SortKey = 'party' | PartyMetricKey;

function PartyTable({ rows, listById }: { rows: PartyClassRow[]; listById: Map<string, PartyListDef> }) {
  // Biggest exposure first, as the mockup opens; any column re-sorts it.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'outstanding', dir: -1 });
  const sorted = useMemo(() => {
    const val = (p: PartyClassRow) => (p.metrics as unknown as Record<string, number | null>)[sort.key] ?? -1;
    return [...rows].sort((a, b) => (sort.key === 'party' ? a.party.localeCompare(b.party) : Number(val(a)) - Number(val(b))) * sort.dir);
  }, [rows, sort]);
  const maxOut = Math.max(1, ...rows.map((p) => p.metrics.outstanding));
  const maxRev = Math.max(1, ...rows.map((p) => p.metrics.lifetimeRevenue));
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'party' ? 1 : -1 }));

  if (rows.length === 0) return <div className="pl-muted py-12 text-center text-[13.5px] font-semibold">No parties here.</div>;

  const head = (key: SortKey, label: string, right = false) => {
    const on = sort.key === key;
    return (
      <th key={key} scope="col" className={cn('pl-th top-0', right ? 'text-right' : 'text-left')} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={cn('pls-sort', right && 'flex-row-reverse')} onClick={() => sortBy(key)}>
          {label}
          <span className={cn('text-[9px]', on ? 'opacity-100' : 'opacity-35')}>{on && sort.dir === 1 ? '▲' : '▼'}</span>
        </button>
      </th>
    );
  };

  return (
    <>
      {/* Desktop: the grid, only this region scrolling sideways. */}
      <div className="hidden max-h-[70vh] overflow-auto [scrollbar-width:thin] sm:block">
        <table className="pl-table min-w-[1180px]">
          <thead>
            <tr>
              {head('party', 'Party')}
              <th scope="col" className="pl-th top-0 text-left">
                Lists
              </th>
              {TABLE_METRICS.map((k) => head(k, META_BY_KEY.get(k)?.label ?? k, true))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              const st = STANDING[standingOf(p.metrics)];
              return (
                <tr key={p.party} className="pl-tr" style={{ '--rail': st.dot, animationDelay: `${Math.min(i, 14) * 25}ms` } as CSSProperties}>
                  <td className="pl-td">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className={cn('pls-av', st.av)} title={st.label}>
                        {initials(p.party)}
                        <span className="pls-av-dot" style={{ background: st.dot }} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="max-w-[260px] truncate text-[14px] font-extrabold">{p.party}</span>
                        <span className="pl-muted truncate text-[11.5px] font-semibold">
                          {p.metrics.agent || 'No agent'} • {p.metrics.region || '—'}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="pl-td">
                    <ListChips p={p} listById={listById} />
                  </td>
                  {TABLE_METRICS.map((k) => (
                    <td key={k} className="pl-td text-right text-[13.5px] whitespace-nowrap tabular-nums">
                      <MetricCell k={k} p={p} maxOut={maxOut} maxRev={maxRev} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phones: a card each, the same figures three to a row. */}
      <div className="flex flex-col gap-2 p-2 sm:hidden">
        {sorted.map((p, i) => {
          const st = STANDING[standingOf(p.metrics)];
          const m = p.metrics as unknown as Record<string, number | null>;
          return (
            <div key={p.party} className="pl-card" style={{ '--rail': st.dot, animationDelay: `${Math.min(i, 14) * 25}ms` } as CSSProperties}>
              <div className="flex items-center gap-2.5">
                <span className={cn('pls-av', st.av)} title={st.label}>
                  {initials(p.party)}
                  <span className="pls-av-dot" style={{ background: st.dot }} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px] leading-tight font-extrabold">{p.party}</span>
                  <span className="pl-muted truncate text-[12px] font-semibold">
                    {p.metrics.agent || 'No agent'}
                    {p.metrics.region ? ` · ${p.metrics.region}` : ''}
                  </span>
                </span>
              </div>
              {p.matched.length > 0 && (
                <div className="mt-2">
                  <ListChips p={p} listById={listById} />
                </div>
              )}
              <div className="pl-card-sum mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 pt-2.5">
                {TABLE_METRICS.map((k) => {
                  const v = m[k];
                  const danger = (k === 'overdue' && Number(v) > 0) || (k === 'brokenPromises' && Number(v) > 0) || (k === 'oldestOverdueDays' && Number(v) >= 60) || (k === 'daysPastCredit' && Number(v) > 0);
                  return (
                    <div key={k} className="min-w-0">
                      <div className="pl-mlabel truncate" title={META_BY_KEY.get(k)?.label}>{SHORT_LABEL[k] ?? META_BY_KEY.get(k)?.label}</div>
                      <div className={cn('text-[14px] font-extrabold tabular-nums', danger && 'text-[#be123c] dark:text-rose-400')}>{fmtMetric(k, v)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── The list editor ─────────────────────────────────────────────────────────── */

const newCondition = (): PartyCondition => ({ field: 'outstanding', op: '>=', value: 0 });
const FIELD_OPTIONS = PARTY_METRIC_META.map((m) => ({ value: m.key, label: m.label }));

function ListBuilder({ lists, parties, editing, onClose }: { lists: PartyListDef[]; parties: PartyClassRow[]; editing: PartyListDef | null; onClose: () => void }) {
  const save = useSavePartyListsConfig();
  const confirm = useConfirm();
  const [name, setName] = useState(editing?.name ?? '');
  const [kind, setKind] = useState<PartyListKind>(editing?.kind ?? 'GREEN');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [match, setMatch] = useState<'ALL' | 'ANY'>(editing?.match ?? 'ALL');
  const [enabled, setEnabled] = useState(editing?.enabled !== false);
  const [conditions, setConditions] = useState<PartyCondition[]>(editing?.conditions?.length ? editing.conditions.map((c) => ({ ...c })) : [newCondition()]);

  const patchCond = (i: number, p: Partial<PartyCondition>) => setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const setField = (i: number, field: PartyMetricKey) => {
    const t = typeOf(field);
    patchCond(i, { field, op: OPERATORS_FOR_TYPE[t][0], value: t === 'text' ? '' : t === 'bool' ? 'true' : 0 });
  };

  // The live preview: who this list would hold if saved now, by the server's rule.
  const draft = conditions.map(normalized);
  const hit = parties.filter((p) => matchPartyList({ match, conditions: draft }, p.metrics)).length;

  const persist = (nextLists: PartyListDef[]) =>
    save.mutate(
      { lists: nextLists },
      {
        onSuccess: () => {
          toast.success('Saved');
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
      },
    );

  const submit = () => {
    if (!name.trim()) return toast.error('Give the list a name.');
    if (conditions.length === 0) return toast.error('Add at least one condition.');
    const def: PartyListDef = {
      id: editing?.id ?? `list-${Math.random().toString(36).slice(2, 9)}`,
      name: name.trim(),
      kind,
      color: null,
      description: description.trim() || null,
      match,
      enabled,
      conditions: conditions.map((c) => ({ ...normalized(c), value: typeOf(c.field) === 'text' || typeOf(c.field) === 'bool' ? String(c.value) : Number(c.value) })),
    };
    persist(editing ? lists.map((l) => (l.id === editing.id ? def : l)) : [...lists, def]);
  };

  useSaveShortcut(submit);

  const remove = async () => {
    if (!editing) return;
    if (!(await confirm({ title: 'Delete this list?', description: `“${editing.name}” will be removed. Parties are re-evaluated instantly.`, confirmText: 'Delete', destructive: true }))) return;
    persist(lists.filter((l) => l.id !== editing.id));
  };

  const last = conditions[conditions.length - 1];
  const lastMeta = last ? META_BY_KEY.get(last.field) : undefined;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="pls-page w-[calc(100vw-1rem)] gap-0 overflow-hidden rounded-[22px] p-0 sm:max-w-[760px]">
        <div className="pls-dlg-head" style={{ '--head': KIND[kind].head } as CSSProperties}>
          <DialogTitle className="text-[18px] font-extrabold text-white">{editing ? 'Edit list' : 'New party list'}</DialogTitle>
          <DialogDescription className="mt-0.5 text-[12.5px] text-white/80">Name it, pick a type, then add the conditions a party must meet.</DialogDescription>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[22px] font-extrabold tabular-nums">{hit}</span>
            <span className="text-[12.5px] font-semibold text-white/85">
              of {parties.length} parties match right now{enabled ? '' : ' (list is off)'}
            </span>
          </div>
        </div>

        <div className="max-h-[62vh] space-y-3.5 overflow-y-auto bg-[#f3f6fb] p-3.5 sm:p-4 dark:bg-transparent">
          <section className="pls-sec grid gap-3 p-3.5 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="pls-label">List name</span>
              <input className="pls-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Black — Crossed credit" autoFocus />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="pls-label">Type</span>
              <div className="grid grid-cols-3 gap-1.5">
                {(['GREEN', 'BLACK', 'CUSTOM'] as PartyListKind[]).map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn('pls-kind', kind === k && KIND[k].chip)} style={{ '--dot': KIND[k].dot } as CSSProperties}>
                    <span className="size-[9px] rounded-full" style={{ background: kind === k && k === 'BLACK' ? '#fff' : KIND[k].dot }} />
                    {KIND[k].label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="pls-label">Description (optional)</span>
              <input className="pls-input text-[13.5px] font-semibold" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this list is for…" />
            </label>
          </section>

          <section className="pls-sec flex flex-col gap-2.5 p-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[14px] font-extrabold">Conditions</span>
              <div role="group" aria-label="Match" className="pl-seg">
                {(['ALL', 'ANY'] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={match === m} onClick={() => setMatch(m)} className="pl-seg-btn h-7 px-2.5 text-[12px]">
                    Match {m}
                  </button>
                ))}
              </div>
              <span className="pl-muted text-[12px] font-semibold">{match === 'ALL' ? 'every condition must hold' : 'any one condition is enough'}</span>
            </div>

            {conditions.map((c, i) => {
              const t = typeOf(c.field);
              const unit = UNIT[t];
              const n = parties.filter((p) => matchPartyCondition(normalized(c), p.metrics)).length;
              return (
                <div key={i} className="pls-crow">
                  <span className="pls-join" data-first={i === 0}>
                    {i === 0 ? 'IF' : match === 'ALL' ? 'AND' : 'OR'}
                  </span>
                  <div className="pl-field min-w-[12rem] flex-1">
                    <NativeSelect value={c.field} onChange={(v) => setField(i, v as PartyMetricKey)} options={FIELD_OPTIONS} />
                  </div>
                  <div className="pl-field w-[7.5rem]">
                    <NativeSelect value={c.op} onChange={(v) => patchCond(i, { op: v as PartyListOperator })} options={OPERATORS_FOR_TYPE[t].map((o) => ({ value: o, label: OP_LABEL[o] }))} />
                  </div>
                  <div className={cn('relative w-[7.5rem]', t === 'bool' && 'pl-field')}>
                    {t === 'bool' ? (
                      <NativeSelect value={String(c.value)} onChange={(v) => patchCond(i, { value: v })} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                    ) : (
                      <>
                        <input
                          className={cn('pls-input text-[13.5px] tabular-nums', unit && 'pr-7')}
                          type={t === 'text' ? 'text' : 'number'}
                          inputMode={t === 'text' ? 'text' : 'decimal'}
                          value={String(c.value)}
                          onChange={(e) => patchCond(i, { value: e.target.value })}
                          placeholder={t === 'text' ? 'value' : '0'}
                          aria-label="Value"
                        />
                        {unit && <span className="pls-unit">{unit}</span>}
                      </>
                    )}
                  </div>
                  <span className="pls-hits" data-zero={n === 0} title="Parties meeting this condition on its own">
                    {n} match
                  </span>
                  <button type="button" onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))} className="pl-eye shrink-0" aria-label="Remove condition">
                    <X className="size-4" />
                  </button>
                </div>
              );
            })}
            <button type="button" className="pls-add" onClick={() => setConditions((cs) => [...cs, newCondition()])}>
              + Add condition
            </button>
            {lastMeta && (
              <p className="pl-muted text-[12px] leading-snug">
                <strong className="font-extrabold">{lastMeta.label}:</strong> {lastMeta.hint}
              </p>
            )}
          </section>

          <label className="pls-sec flex cursor-pointer items-center justify-between gap-3 p-3.5">
            <span>
              <span className="block text-[14px] font-extrabold">List is active</span>
              <span className="pl-muted block text-[12px]">Parties are evaluated live against these conditions.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
        </div>

        <div className="flex items-center gap-2 border-t bg-white/90 px-4 py-3 dark:bg-transparent">
          {editing && (
            <button type="button" className="pl-btn text-rose-600 dark:text-rose-400" onClick={remove}>
              <Trash2 className="size-4" /> Delete
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="pl-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pl-btn pl-btn-primary px-4 text-[14px]" onClick={submit} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Save list
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PartyListsPage;
