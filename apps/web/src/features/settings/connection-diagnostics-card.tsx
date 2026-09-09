import { useSyncExternalStore } from 'react';
import { Activity, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  clearNetEvents,
  getNetEvents,
  subscribeToNetEvents,
  type NetEvent,
} from '@/lib/net-diagnostics';

const time = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Plain-English meaning for the axios codes, so the list is readable by
 *  someone who is not going to look them up. */
const DETAIL_LABEL: Record<string, string> = {
  ECONNABORTED: 'timed out',
  ERR_CANCELED: 'cancelled on resume',
  ERR_NETWORK: 'connection died',
  'no-response': 'no reply',
};

const TONE: Record<NetEvent['kind'], string> = {
  ok: 'text-emerald-600',
  fail: 'text-rose-600',
  resume: 'text-indigo-600',
  online: 'text-emerald-600',
  offline: 'text-amber-600',
};

/**
 * Shows what the network actually did on THIS device.
 *
 * The point is the timeline around "app resumed": how long the calls after a
 * wake-up took, and whether they timed out, were cancelled, or simply died.
 * That sequence is the difference between "the VPN is slow" and "the VPN was
 * gone", which is not something anyone can report reliably from memory.
 */
export function ConnectionDiagnosticsCard() {
  const events = useSyncExternalStore(subscribeToNetEvents, getNetEvents, getNetEvents);

  const fails = events.filter((e) => e.kind === 'fail');
  const oks = events.filter((e) => e.kind === 'ok');
  const slowest = oks.reduce((m, e) => Math.max(m, e.ms ?? 0), 0);
  const byCode = fails.reduce<Record<string, number>>((acc, e) => {
    const k = e.detail ?? '?';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const asText = () =>
    events
      .map((e) => {
        const ms = e.ms != null ? ` ${e.ms}ms` : '';
        const d = e.detail ? ` [${e.detail}]` : '';
        return `${time(e.t)} ${e.kind.toUpperCase()} ${e.label}${ms}${d}`;
      })
      .join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      toast.success('Diagnostics copied — paste them into the chat');
    } catch {
      toast.error('Could not copy. Take a screenshot of the list instead.');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-indigo-600" /> Connection Diagnostics
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Records what the network did on this device — every API call, how long it took, and each time the app woke
          up. Nothing is sent anywhere. To capture a problem: tap <strong>Clear</strong>, lock the phone for a few
          minutes, unlock, use the app until it misbehaves, then come back and tap <strong>Copy</strong>.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border p-2.5 text-xs">
          <span>
            <strong>{oks.length}</strong> succeeded
          </span>
          <span className={cn(fails.length > 0 && 'text-rose-600')}>
            <strong>{fails.length}</strong> failed
          </span>
          <span>
            slowest success <strong>{slowest ? `${slowest}ms` : '—'}</strong>
          </span>
          {Object.entries(byCode).map(([code, n]) => (
            <span key={code} className="text-rose-600">
              {DETAIL_LABEL[code] ?? code}: <strong>{n}</strong>
            </span>
          ))}
        </div>

        <div className="max-h-80 overflow-y-auto rounded-md border">
          {events.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">
              Nothing recorded yet. Use the app for a moment and events will appear here.
            </p>
          ) : (
            <ul className="divide-y text-[12px]">
              {[...events].reverse().map((e, i) => (
                <li key={`${e.t}-${i}`} className="flex items-baseline gap-2 px-2.5 py-1.5">
                  <span className="text-muted-foreground shrink-0 font-mono">{time(e.t)}</span>
                  <span className={cn('shrink-0 font-semibold uppercase', TONE[e.kind])}>{e.kind}</span>
                  <span className="min-w-0 flex-1 truncate">{e.label}</span>
                  {e.ms != null && (
                    <span className={cn('shrink-0 font-mono', e.ms > 3000 && 'font-bold text-rose-600')}>
                      {e.ms}ms
                    </span>
                  )}
                  {e.detail && (
                    <span className="text-muted-foreground shrink-0">{DETAIL_LABEL[e.detail] ?? e.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copy} disabled={!events.length}>
            <Copy className="size-3.5" /> Copy
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearNetEvents} disabled={!events.length}>
            <Trash2 className="size-3.5" /> Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
