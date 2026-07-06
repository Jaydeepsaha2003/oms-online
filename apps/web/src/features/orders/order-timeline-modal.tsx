import { useMemo, useState } from 'react';
import { Ban, ChevronDown, CircleCheck, ClipboardList, Clock, Loader2, Package, ScrollText, Truck } from 'lucide-react';
import type { OrderDto, OrderTimeline, OrderTimelineDispatch, OrderTimelineLine } from '@oms/shared';
import { cn, shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useOrderTimeline } from './use-orders';

/* Staggered pop-in per node + a growing connector rail + pulsing "awaiting" dot. */
const TIMELINE_CSS = `
@keyframes tl-pop { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
@keyframes tl-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes tl-ping { 0% { transform: scale(1); opacity: .75; } 70%,100% { transform: scale(2.1); opacity: 0; } }
.tl-node { animation: tl-pop .5s cubic-bezier(.2,.7,.3,1) both; }
.tl-rail { transform-origin: top; animation: tl-grow .55s ease-out both; }
.tl-ping { animation: tl-ping 1.6s cubic-bezier(0,0,.2,1) infinite; }
@media (prefers-reduced-motion: reduce) {
  .tl-node, .tl-rail, .tl-ping { animation: none !important; }
}`;

const qtyText = (q: { bags?: number | null; pcs?: number | null; kgs?: number | null; box?: number | null }) => {
  const parts: string[] = [];
  if (q.bags) parts.push(`${q.bags.toLocaleString('en-IN')} bags`);
  if (q.pcs) parts.push(`${q.pcs.toLocaleString('en-IN')} pcs`);
  if (q.kgs) parts.push(`${q.kgs.toLocaleString('en-IN')} kg`);
  if (q.box) parts.push(`${q.box.toLocaleString('en-IN')} box`);
  return parts.join(' · ') || '—';
};
const sumQty = (rows: { bags?: number | null; pcs?: number | null; kgs?: number | null; box?: number | null }[]) => ({
  bags: rows.reduce((a, r) => a + (r.bags ?? 0), 0),
  pcs: rows.reduce((a, r) => a + (r.pcs ?? 0), 0),
  kgs: rows.reduce((a, r) => a + (r.kgs ?? 0), 0),
  box: rows.reduce((a, r) => a + (r.box ?? 0), 0),
});

type Tone = 'emerald' | 'sky' | 'violet' | 'amber' | 'rose' | 'slate';
const Chip = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset',
      tone === 'emerald' && 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      tone === 'sky' && 'bg-sky-50 text-sky-700 ring-sky-200',
      tone === 'violet' && 'bg-violet-50 text-violet-700 ring-violet-200',
      tone === 'amber' && 'bg-amber-50 text-amber-700 ring-amber-200',
      tone === 'rose' && 'bg-rose-50 text-rose-700 ring-rose-200',
      tone === 'slate' && 'bg-slate-100 text-slate-600 ring-slate-200',
    )}
  >
    {children}
  </span>
);

/* ── Chronological events: order placed → dispatch days → challans → awaiting ── */

type DispatchWithLine = { d: OrderTimelineDispatch; line: OrderTimelineLine };
type Ev =
  | { key: string; kind: 'ordered'; date: string; t: OrderTimeline }
  | { key: string; kind: 'dispatchDay'; date: string; items: DispatchWithLine[] }
  | { key: string; kind: 'challan'; date: string; code: string; status: string; items: DispatchWithLine[] }
  | { key: string; kind: 'awaiting'; lines: OrderTimelineLine[] };

function buildEvents(t: OrderTimeline): Ev[] {
  const all: DispatchWithLine[] = t.lines.flatMap((line) => line.dispatches.map((d) => ({ d, line })));

  // Dispatches grouped by calendar day.
  const byDay = new Map<string, DispatchWithLine[]>();
  for (const x of all) {
    const day = x.d.dispatchDate.slice(0, 10);
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(x);
  }

  // Challans grouped by challan (each shown once, with every item it billed).
  const byChallan = new Map<number, { code: string; status: string; date: string; items: DispatchWithLine[] }>();
  for (const x of all) {
    const c = x.d.challan;
    if (!c) continue;
    const entry = byChallan.get(c.id) ?? byChallan.set(c.id, { code: c.code, status: c.challanStatus, date: c.invDate, items: [] }).get(c.id)!;
    entry.items.push(x);
  }

  type DatedEv = Extract<Ev, { kind: 'dispatchDay' | 'challan' }>;
  const dated: DatedEv[] = [
    ...[...byDay.entries()].map(([day, items]): DatedEv => ({ key: `day-${day}`, kind: 'dispatchDay', date: day, items })),
    ...[...byChallan.entries()].map(([id, c]): DatedEv => ({ key: `ch-${id}`, kind: 'challan', date: c.date.slice(0, 10), code: c.code, status: c.status, items: c.items })),
  ];
  // One chronological story; a same-day challan follows its dispatch.
  dated.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'dispatchDay' ? -1 : 1));
  const events: Ev[] = [{ key: 'ordered', kind: 'ordered', date: t.orderDate.slice(0, 10), t }, ...dated];

  const awaiting = t.lines.filter((l) => l.status !== 'CANCELLED' && !l.fullyDispatched);
  if (awaiting.length) events.push({ key: 'awaiting', kind: 'awaiting', lines: awaiting });
  return events;
}

/* ── Building blocks ─────────────────────────────────────────────────────────── */

const Dot = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className={cn('relative z-[1] flex size-9 items-center justify-center rounded-full shadow-sm ring-4 ring-white', className)}>{children}</span>
);

function Node({
  index,
  last,
  dot,
  ping,
  children,
}: {
  index: number;
  last?: boolean;
  dot: React.ReactNode;
  ping?: boolean;
  children: React.ReactNode;
}) {
  const delay = `${Math.min(index, 10) * 130}ms`;
  return (
    <div className="tl-node relative flex gap-3" style={{ animationDelay: delay }}>
      <div className="flex w-9 shrink-0 flex-col items-center">
        <div className="relative">
          {ping && <span className="tl-ping absolute inset-0 rounded-full bg-amber-400/60" style={{ animationDelay: delay }} />}
          {dot}
        </div>
        {!last && <div className="tl-rail -mb-2 mt-1 w-px flex-1 bg-gradient-to-b from-slate-300 to-slate-200" style={{ animationDelay: delay }} />}
      </div>
      <div className={cn('min-w-0 flex-1', last ? 'pb-1' : 'pb-4')}>{children}</div>
    </div>
  );
}

/** Soft event card; when `items` are passed it expands to reveal them. */
function EventCard({
  tone,
  header,
  sub,
  expandLabel,
  expanded,
  onToggle,
  children,
}: {
  tone: Tone;
  header: React.ReactNode;
  sub?: React.ReactNode;
  expandLabel?: string;
  expanded?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}) {
  const expandable = onToggle != null;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border transition-shadow',
        tone === 'emerald' && 'border-emerald-200/70 bg-gradient-to-r from-emerald-50/70 to-transparent',
        tone === 'sky' && 'border-sky-200/70 bg-gradient-to-r from-sky-50/70 to-transparent',
        tone === 'violet' && 'border-violet-200/70 bg-gradient-to-r from-violet-50/70 to-transparent',
        tone === 'amber' && 'border-amber-200/70 bg-gradient-to-r from-amber-50/70 to-transparent',
        tone === 'slate' && 'border-slate-200 bg-slate-50/60',
        expandable && 'cursor-pointer hover:shadow-md',
      )}
      onClick={expandable ? onToggle : undefined}
      role={expandable ? 'button' : undefined}
      aria-expanded={expandable ? expanded : undefined}
    >
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">{header}</div>
          {sub && <div className="text-muted-foreground mt-0.5 text-sm">{sub}</div>}
        </div>
        {expandable && (
          <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs font-medium">
            {expandLabel}
            <ChevronDown className={cn('size-4 transition-transform duration-200', expanded && 'rotate-180')} />
          </span>
        )}
      </div>
      {/* smooth expand/collapse */}
      <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-black/5 bg-white/70 px-3.5 py-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** One item row inside an expanded event. */
function ItemRow({ x }: { x: DispatchWithLine }) {
  const full = x.d.dispatchStatus === 'FULLY DISPATCH';
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm [&+&]:border-t [&+&]:border-slate-100">
      <Package className="size-3.5 shrink-0 text-slate-400" />
      <span className="font-medium">{x.line.productName || '(item)'}</span>
      {x.line.designType && x.line.designType !== 'NA' && <span className="text-muted-foreground text-xs">{x.line.designType}</span>}
      <span className="text-muted-foreground ml-auto text-xs tabular-nums">{qtyText(x.d)}</span>
      <Chip tone={full ? 'emerald' : 'sky'}>{full ? <CircleCheck className="size-3" /> : <Truck className="size-3" />}{full ? 'Full' : 'Partial'}</Chip>
      {x.d.code && <span className="text-muted-foreground font-mono text-[10px]">{x.d.code}</span>}
    </div>
  );
}

/* ── Modal ───────────────────────────────────────────────────────────────────── */

export function OrderTimelineModal({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const { data: t, isLoading, isError } = useOrderTimeline(order.id);
  const events = useMemo(() => (t ? buildEvents(t) : []), [t]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl gap-3">
        <style>{TIMELINE_CSS}</style>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Truck className="text-primary size-5" /> Order journey — {shortOrderCode(order.code, order.id)}
          </DialogTitle>
          <DialogDescription>
            {order.customerName} · the story of this order — click an event to see the items in it.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[68vh] overflow-y-auto px-1 pt-1">
          {isLoading && (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-14 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading the journey…
            </div>
          )}
          {isError && <p className="text-destructive py-10 text-center text-sm">Could not load the order timeline.</p>}

          {t &&
            events.map((ev, i) => {
              const last = i === events.length - 1;

              if (ev.kind === 'ordered') {
                const cancelled = ev.t.lines.filter((l) => l.status === 'CANCELLED');
                return (
                  <Node key={ev.key} index={i} last={last} dot={<Dot className="bg-emerald-100 text-emerald-700"><ClipboardList className="size-4" /></Dot>}>
                    <EventCard
                      tone="emerald"
                      header={<>
                        <span className="font-semibold">Order placed</span>
                        <span className="text-muted-foreground text-xs">{formatDate(ev.t.orderDate)}</span>
                        <Chip tone={ev.t.status === 'CANCELLED' ? 'rose' : 'emerald'}>{ev.t.status}</Chip>
                      </>}
                      sub={<>
                        {ev.t.lines.length} item(s){ev.t.completionDate ? ` · due ${formatDate(ev.t.completionDate)}` : ''}
                        {cancelled.length ? ` · ${cancelled.length} cancelled` : ''}
                      </>}
                      expandLabel={`${ev.t.lines.length} items`}
                      expanded={open.has(ev.key)}
                      onToggle={() => toggle(ev.key)}
                    >
                      {ev.t.lines.map((l) => (
                        <div key={l.orderItemId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm [&+&]:border-t [&+&]:border-slate-100">
                          {l.status === 'CANCELLED' ? <Ban className="size-3.5 shrink-0 text-rose-400" /> : <Package className="size-3.5 shrink-0 text-slate-400" />}
                          <span className={cn('font-medium', l.status === 'CANCELLED' && 'text-muted-foreground line-through')}>{l.productName || '(item)'}</span>
                          {l.designType && l.designType !== 'NA' && <span className="text-muted-foreground text-xs">{l.designType}</span>}
                          <span className="text-muted-foreground ml-auto text-xs tabular-nums">{qtyText(l)}</span>
                          {l.status === 'CANCELLED' ? (
                            <Chip tone="rose">Cancelled</Chip>
                          ) : l.fullyDispatched ? (
                            <Chip tone="emerald"><CircleCheck className="size-3" /> Dispatched</Chip>
                          ) : l.dispatches.length ? (
                            <Chip tone="sky">Partial</Chip>
                          ) : (
                            <Chip tone="amber">Pending</Chip>
                          )}
                        </div>
                      ))}
                    </EventCard>
                  </Node>
                );
              }

              if (ev.kind === 'dispatchDay') {
                const total = sumQty(ev.items.map((x) => x.d));
                return (
                  <Node key={ev.key} index={i} last={last} dot={<Dot className="bg-sky-100 text-sky-700"><Truck className="size-4" /></Dot>}>
                    <EventCard
                      tone="sky"
                      header={<>
                        <span className="font-semibold">Dispatched</span>
                        <span className="text-muted-foreground text-xs">{formatDate(ev.date)}</span>
                        {ev.items.some((x) => x.d.dispatchStatus === 'FULLY DISPATCH') && <Chip tone="emerald"><CircleCheck className="size-3" /> closes line(s)</Chip>}
                      </>}
                      sub={<>{ev.items.length} item(s) · {qtyText(total)}</>}
                      expandLabel={`${ev.items.length} items`}
                      expanded={open.has(ev.key)}
                      onToggle={() => toggle(ev.key)}
                    >
                      {ev.items.map((x) => <ItemRow key={x.d.id} x={x} />)}
                    </EventCard>
                  </Node>
                );
              }

              if (ev.kind === 'challan') {
                const cancelled = ev.status === 'CANCELLED';
                const total = sumQty(ev.items.map((x) => x.d));
                return (
                  <Node key={ev.key} index={i} last={last} dot={<Dot className="bg-violet-100 text-violet-700"><ScrollText className="size-4" /></Dot>}>
                    <EventCard
                      tone="violet"
                      header={<>
                        <span className="font-semibold">Challan created</span>
                        <span className={cn('font-mono text-xs font-semibold', cancelled ? 'text-muted-foreground line-through' : 'text-violet-700')}>{ev.code}</span>
                        <span className="text-muted-foreground text-xs">{formatDate(ev.date)}</span>
                        {cancelled && <Chip tone="rose">CANCELLED</Chip>}
                      </>}
                      sub={<>bills {ev.items.length} dispatched item(s) · {qtyText(total)}</>}
                      expandLabel={`${ev.items.length} items`}
                      expanded={open.has(ev.key)}
                      onToggle={() => toggle(ev.key)}
                    >
                      {ev.items.map((x) => <ItemRow key={`${ev.key}-${x.d.id}`} x={x} />)}
                    </EventCard>
                  </Node>
                );
              }

              // awaiting
              return (
                <Node key={ev.key} index={i} last ping dot={<Dot className="bg-amber-100 text-amber-600"><Clock className="size-4" /></Dot>}>
                  <EventCard
                    tone="amber"
                    header={<>
                      <span className="font-semibold">Awaiting dispatch</span>
                      <Chip tone="amber">{ev.lines.length} line(s) open</Chip>
                    </>}
                    sub="These items are not fully dispatched yet."
                    expandLabel={`${ev.lines.length} items`}
                    expanded={open.has(ev.key)}
                    onToggle={() => toggle(ev.key)}
                  >
                    {ev.lines.map((l) => (
                      <div key={l.orderItemId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm [&+&]:border-t [&+&]:border-slate-100">
                        <Clock className="size-3.5 shrink-0 text-amber-400" />
                        <span className="font-medium">{l.productName || '(item)'}</span>
                        {l.designType && l.designType !== 'NA' && <span className="text-muted-foreground text-xs">{l.designType}</span>}
                        <span className="text-muted-foreground ml-auto text-xs tabular-nums">ordered {qtyText(l)}</span>
                        <Chip tone={l.dispatches.length ? 'sky' : 'amber'}>{l.dispatches.length ? 'Partial' : 'Untouched'}</Chip>
                      </div>
                    ))}
                  </EventCard>
                </Node>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
