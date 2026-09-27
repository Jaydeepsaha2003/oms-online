import { useMemo, useState, type CSSProperties } from 'react';
import { Loader2, PauseCircle, PlayCircle, Search } from 'lucide-react';
import { isRealDesign, type HeldPartyDto, type PendingLineDto } from '@oms/shared';
import { shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { NativeSelect } from '@/components/common/combo';
import { inrCompact } from '@/features/dashboard/format';
import { useCustomers } from '@/features/customers/use-customers';
import { DispatchHoldDialog, holdPartyOf, type HoldParty } from '@/features/customers/dispatch-hold-dialog';
import { useHeldParties } from './use-dispatch';

/** A line's still-to-dispatch quantity, e.g. "4 Bags · 120 Pcs". */
const remText = (l: PendingLineDto) =>
  (
    [
      ['Bags', l.remBags],
      ['Pcs', l.remPcs],
      ['Kgs', l.remKgs],
      ['Box', l.remBox],
    ] as const
  )
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ') || '—';

/** Its pending value, worked out as the dispatch card does (0 without rates). */
const remValue = (l: PendingLineDto) =>
  l.rate == null ? 0 : l.rate * ((l.calField ?? '').toUpperCase() === 'PCS' ? l.remPcs : l.remKgs);

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * Parties on dispatch hold. Their pending orders are left out of Dispatch Order
 * (DispatchService.dispatchablePendingLines) and wait here until released.
 */
export function PartyOnHoldPage() {
  const { can } = usePermissions();
  // Holds are a customer setting — the same permission the Customers page asks.
  const canHold = can('customer:update');
  const { data: parties = [], isLoading } = useHeldParties();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ party: HoldParty; hold: boolean } | null>(null);

  const totals = useMemo(() => {
    const lines = parties.flatMap((p) => p.lines);
    return {
      orders: new Set(lines.map((l) => l.orderId)).size,
      lines: lines.length,
      value: lines.reduce((s, l) => s + remValue(l), 0),
      rated: lines.some((l) => l.rate != null),
    };
  }, [parties]);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return parties;
    return parties.filter((p) => [p.name, p.agentName, p.region, p.hold.reason].some((v) => (v ?? '').toLowerCase().includes(s)));
  }, [parties, search]);

  const tiles = [
    { label: 'Parties on hold', value: parties.length, hint: 'no new dispatch' },
    { label: 'Orders held back', value: totals.orders, hint: 'hidden from Dispatch Order' },
    { label: 'Lines held back', value: totals.lines, hint: 'still to dispatch' },
    ...(totals.rated ? [{ label: 'Value held back', value: inrCompact(totals.value), hint: 'at order rates' }] : []),
  ];

  return (
    <div className="pls-page flex flex-col gap-3.5">
      <div className="pls-backdrop" aria-hidden />

      <section className="pls-hero">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[12px] font-bold tracking-[0.04em] text-white/80">Dispatch · Party on hold</span>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[40px] leading-none font-extrabold tracking-[-0.03em] tabular-nums">{isLoading ? '—' : parties.length}</span>
              <span className="text-[15px] font-bold text-white/90">{plural(parties.length, 'party', 'parties')} on hold</span>
            </div>
            <p className="mt-1.5 text-[13px] text-white/80">No orders, drafts, quotations or bookings can be made for them, and their orders are hidden from Dispatch Order, until the hold is released.</p>
          </div>
          {canHold && <HoldPicker onPick={(party) => setDialog({ party, hold: true })} />}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="pls-htile">
              <div className="pls-htile-label">{t.label}</div>
              <div className="mt-0.5 text-[22px] font-extrabold tabular-nums">{isLoading ? '—' : t.value}</div>
              <div className="truncate text-[11.5px] text-white/75">{t.hint}</div>
            </div>
          ))}
        </div>
      </section>

      {isLoading ? (
        <div className="pl-muted flex items-center justify-center gap-2 py-16 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading held parties…
        </div>
      ) : !parties.length ? (
        <div className="pls-card flex flex-col items-center gap-2 p-10 text-center" style={{ '--bar': '#34d399' } as CSSProperties}>
          <PlayCircle className="size-8 text-emerald-500" />
          <p className="text-[15px] font-extrabold">No party is on hold</p>
          <p className="pl-muted text-[13px]">Every party's orders are on Dispatch Order.</p>
        </div>
      ) : (
        <>
          <label className="pls-search block sm:max-w-sm">
            <Search className="pl-muted absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search party, agent, region or reason…" aria-label="Search held parties" />
          </label>
          {shown.length ? (
            <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3">
              {shown.map((p, i) => (
                <HeldCard key={p.id} p={p} index={i} onRelease={canHold ? () => setDialog({ party: holdPartyOf(p.id, p.name, p.hold), hold: false }) : undefined} />
              ))}
            </section>
          ) : (
            <p className="pl-muted py-10 text-center text-[13px]">No held party matches “{search.trim()}”.</p>
          )}
        </>
      )}

      {dialog && <DispatchHoldDialog parties={[dialog.party]} hold={dialog.hold} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Search the parties that are not on hold yet and pick one to hold. */
function HoldPicker({ onPick }: { onPick: (p: HoldParty) => void }) {
  const [q, setQ] = useState('');
  const { data } = useCustomers({ search: q, pageSize: 20 });
  const free = (data?.items ?? []).filter((c) => !c.dispatchHold);
  return (
    <div className="w-full sm:w-[300px]">
      <div className="pls-htile-label mb-1">
        <PauseCircle className="size-3.5" /> Hold a party
      </div>
      <NativeSelect
        value=""
        onChange={(id) => {
          const c = free.find((x) => String(x.id) === id);
          if (c) onPick(c);
        }}
        onType={setQ}
        options={free.map((c) => ({ value: String(c.id), label: c.partyName ?? `#${c.id}` }))}
        placeholder="Search a party to hold…"
        className="h-10 rounded-[12px] text-[13.5px] font-semibold"
      />
    </div>
  );
}

function HeldCard({ p, index, onRelease }: { p: HeldPartyDto; index: number; onRelease?: () => void }) {
  const orders = new Set(p.lines.map((l) => l.orderId)).size;
  const value = p.lines.reduce((s, l) => s + remValue(l), 0);
  const placed = [p.hold.by && `by ${p.hold.by}`, p.hold.at && `on ${formatDate(p.hold.at)}`].filter(Boolean).join(' ');
  return (
    <div
      className="pls-card flex flex-col gap-3 p-4 pt-5"
      style={{ '--bar': 'linear-gradient(90deg, #fbbf24, #f97316)', animationDelay: `${Math.min(index, 10) * 60}ms` } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span className="pls-icon" style={{ '--icon': 'linear-gradient(180deg, #fbbf24, #f59e0b)', '--dot': '#f59e0b' } as CSSProperties}>
          <PauseCircle className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-tight font-extrabold">{p.name}</span>
          <span className="pl-muted mt-0.5 block truncate text-[12px]">{[p.agentName, p.region].filter(Boolean).join(' · ') || 'No agent'}</span>
        </div>
        {onRelease && (
          <button
            type="button"
            onClick={onRelease}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] bg-emerald-600 px-3 text-[12.5px] font-extrabold text-white transition-colors hover:bg-emerald-700"
          >
            <PlayCircle className="size-4" /> Release
          </button>
        )}
      </div>

      <div className="rounded-[12px] bg-amber-50 px-3 py-2 ring-1 ring-amber-200 ring-inset dark:bg-amber-400/10 dark:ring-amber-400/25">
        <p className="text-[12.5px] leading-snug font-bold text-amber-900 dark:text-amber-200">{p.hold.reason?.trim() || 'No reason given'}</p>
        {placed && <p className="mt-0.5 text-[11px] font-semibold text-amber-800/75 dark:text-amber-200/65">Held {placed}</p>}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[30px] leading-none font-extrabold text-amber-600 tabular-nums">{orders}</span>
          <span className="pl-muted text-[12px] font-semibold">{plural(orders, 'order')} held back</span>
        </div>
        {value > 0 && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-[16px] font-extrabold tabular-nums">{inrCompact(value)}</span>
            <span className="pl-muted text-[12px] font-semibold">pending</span>
          </div>
        )}
      </div>

      {p.lines.length ? (
        <details>
          <summary className="cursor-pointer text-[12.5px] font-extrabold text-[#2f3fb5] dark:text-indigo-300">
            Show {p.lines.length} {plural(p.lines.length, 'line')} held back
          </summary>
          <ul className="mt-2 divide-y divide-slate-200 dark:divide-white/10">
            {p.lines.map((l) => (
              <li key={l.orderItemId} className="flex items-center gap-2 py-1.5 text-[12.5px]" title={`Ordered ${formatDate(l.orderDate)}`}>
                <span className="bg-primary/10 text-primary shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-bold">
                  {shortOrderCode(l.orderCode, l.orderId)}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {l.productName || l.product}
                  {isRealDesign(l.designType) ? ` · ${l.designType}` : ''}
                </span>
                <span className="shrink-0 font-bold tabular-nums">{remText(l)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="pl-muted text-[12px]">Nothing pending to dispatch.</p>
      )}
    </div>
  );
}
