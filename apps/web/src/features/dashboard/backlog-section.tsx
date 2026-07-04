import { AlertTriangle, CircleCheck, Clock, Layers, PackageOpen } from 'lucide-react';
import type { AgingBucket } from '@oms/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useBacklog } from './use-analytics';
import { inrCompact, inrFull, numCompact } from './format';

// Severity ramp for the age bands — older = redder = act first.
const BAND_TONE: Record<string, { bar: string; text: string; dot: string }> = {
  '0-7': { bar: 'bg-emerald-500', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  '8-15': { bar: 'bg-amber-500', text: 'text-amber-700', dot: 'bg-amber-500' },
  '16-30': { bar: 'bg-orange-500', text: 'text-orange-700', dot: 'bg-orange-500' },
  '30+': { bar: 'bg-red-600', text: 'text-red-700', dot: 'bg-red-600' },
};

function MiniCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof PackageOpen;
  tone: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-muted-foreground flex items-center justify-between text-xs font-medium">
        {label}
        <Icon className={cn('size-4', tone)} />
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div>}
    </div>
  );
}

function AgingRow({ b, max }: { b: AgingBucket; max: number }) {
  const tone = BAND_TONE[b.key] ?? BAND_TONE['0-7'];
  const pct = max > 0 ? Math.max(b.value > 0 ? 4 : 0, (b.value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium">
        <span className={cn('size-2 rounded-full', tone.dot)} />
        {b.label}
      </div>
      <div className="bg-muted h-5 min-w-0 flex-1 overflow-hidden rounded">
        <div
          className={cn('flex h-full items-center justify-end rounded pr-1.5', tone.bar)}
          style={{ width: `${pct}%` }}
        >
          {pct > 22 && <span className="text-[10px] font-semibold text-white tabular-nums">{inrCompact(b.value)}</span>}
        </div>
      </div>
      <div className="w-20 shrink-0 text-right text-xs tabular-nums">
        <span className={cn('font-semibold', tone.text)}>{b.orders}</span>
        <span className="text-muted-foreground"> order{b.orders === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}

export function BacklogSection() {
  const { data, isLoading } = useBacklog();
  const maxBand = data ? Math.max(1, ...data.aging.map((a) => a.value)) : 1;
  const empty = data && data.openOrders === 0;

  return (
    <Card className="card-hover">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-sm">
            <PackageOpen className="size-4" />
          </span>
          Order backlog
          <span className="text-muted-foreground text-xs font-normal">ordered, not yet dispatched</span>
          {data && data.oldestDays > 0 && !empty && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              <Clock className="size-3" /> oldest {data.oldestDays}d
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="bg-muted h-40 animate-pulse rounded-lg" />
        ) : empty ? (
          <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
            <CircleCheck className="size-5 text-emerald-500" /> No open orders — everything ordered has been dispatched.
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniCard
                label="Open value"
                value={inrCompact(data.openValue)}
                hint={`${data.openOrders} order${data.openOrders === 1 ? '' : 's'} · ${data.openLines} line${data.openLines === 1 ? '' : 's'}`}
                icon={PackageOpen}
                tone="text-violet-600"
              />
              <MiniCard
                label="To dispatch"
                value={`${numCompact(data.pendingBags)} bags`}
                hint={`${numCompact(data.pendingKgs)} kgs pending`}
                icon={Layers}
                tone="text-sky-600"
              />
              <MiniCard
                label="Urgent pending"
                value={data.urgentOrders.toLocaleString('en-IN')}
                hint={data.urgentValue > 0 ? `${inrCompact(data.urgentValue)} to ship` : 'no urgent orders'}
                icon={AlertTriangle}
                tone="text-red-600"
              />
            </div>

            <div>
              <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium">
                <span>Aging by order date — clear the oldest first</span>
                <span>orders</span>
              </div>
              <div className="space-y-1.5">
                {data.aging.map((b) => (
                  <AgingRow key={b.key} b={b} max={maxBand} />
                ))}
              </div>
              <div className="text-muted-foreground mt-2 text-right text-xs tabular-nums" title={inrFull(data.openValue)}>
                Total open value {inrCompact(data.openValue)}
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
