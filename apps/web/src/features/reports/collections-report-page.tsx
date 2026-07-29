import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HandCoins } from 'lucide-react';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';
import { Kpi, RankedBars, ReportCard, ReportHeader, ReportSummary } from './report-kit';
import { useCollectionsReport } from './use-reports';

const flagTone = (flag: string) => {
  if (flag.includes('60+')) return 'bg-red-50 text-red-700 ring-red-600/20';
  if (flag.includes('30')) return 'bg-orange-50 text-orange-700 ring-orange-600/20';
  if (flag.startsWith('CALL')) return 'bg-amber-50 text-amber-700 ring-amber-600/20';
  if (flag === 'WATCH') return 'bg-slate-100 text-slate-600 ring-slate-500/20';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
};
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

export function CollectionsReportPage() {
  const { data, isLoading } = useCollectionsReport();

  return (
    <div className="space-y-5">
      <ReportHeader title="Collections & Recovery" subtitle="How much is owed, how old it is, and who to chase first." icon={HandCoins} asOf={data?.asOf} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          { text: <>Total outstanding is <strong>{inrCompact(data.totalOutstanding)}</strong>, of which <strong>{inrCompact(data.overdue)}</strong>{data.totalOutstanding > 0 && <> ({Math.round((data.overdue / data.totalOutstanding) * 100)}%)</>} is overdue.</>, tone: data.overdue > 0 ? 'bad' : 'good' },
          { text: <><strong>{inrCompact(data.dueSoon)}</strong> falls due in the next 15 days — get ahead of it.</>, tone: 'warn' },
          { text: <><strong>{data.recovery.filter((r) => r.rank <= 3).length}</strong> parties need a call now; <strong>{data.recovery[0]?.party ?? '—'}</strong> tops the list at <strong>{inrCompact(data.recovery[0]?.outstanding ?? 0)}</strong>.</>, tone: 'bad' },
          { text: <>Collections this FY are <strong>{Math.round((((data.collectedModes ?? []).find((m) => m.name === 'Cash')?.value ?? 0) / ((data.collectedModes ?? []).reduce((s, m) => s + m.value, 0) || 1)) * 100)}%</strong> cash vs bank.</>, tone: 'info' },
          ...(data.advanceHeld > 0 ? [{ text: <><strong>{inrCompact(data.advanceHeld)}</strong> is held as advances — net these before chasing.</>, tone: 'info' as const }] : []),
        ] : []}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total outstanding" value={data ? inrCompact(data.totalOutstanding) : '—'} title={data ? inrFull(data.totalOutstanding) : undefined} hint="net receivable" loading={isLoading} tone="rose" />
        <Kpi label="Overdue" value={data ? inrCompact(data.overdue) : '—'} title={data ? inrFull(data.overdue) : undefined} hint="past due date" loading={isLoading} tone="amber" />
        <Kpi label="Due soon" value={data ? inrCompact(data.dueSoon) : '—'} title={data ? inrFull(data.dueSoon) : undefined} hint="next 15 days" loading={isLoading} tone="blue" />
        <Kpi label="Advance held" value={data ? inrCompact(data.advanceHeld) : '—'} title={data ? inrFull(data.advanceHeld) : undefined} hint="money in hand" loading={isLoading} tone="emerald" />
      </div>

      <ReportCard title="Overdue by age">
        {isLoading ? <div className="bg-muted h-[260px] animate-pulse rounded-lg" /> : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.aging ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => inrCompact(v)} />
                <Tooltip formatter={(v: number, _n, p) => [inrFull(v), `${p.payload.parties} parties`]} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Bar dataKey="value" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={64} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Collected by mode (FY)">{isLoading ? <div className="bg-muted h-44 animate-pulse rounded-lg" /> : <RankedBars data={data?.collectedModes ?? []} emptyText="No receipts this FY." />}</ReportCard>
        <ReportCard title="Top overdue parties">{isLoading ? <div className="bg-muted h-44 animate-pulse rounded-lg" /> : <RankedBars data={data?.topOverdueParties ?? []} emptyText="Nothing overdue." />}</ReportCard>
      </div>

      <ReportCard title="Recovery call list — highest priority first">
        {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : !data?.recovery.length ? (
          <div className="text-muted-foreground py-8 text-center text-sm">Nothing to chase — you're all clear. 🎉</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs uppercase tracking-wide">
                  <th className="py-2 pr-3 font-semibold">Party</th>
                  <th className="py-2 pr-3 font-semibold">Priority</th>
                  <th className="py-2 pr-3 text-right font-semibold">Outstanding</th>
                  <th className="py-2 pr-3 text-right font-semibold">Overdue</th>
                  <th className="py-2 pr-3 text-right font-semibold">Oldest</th>
                  <th className="py-2 pr-3 font-semibold">Last receipt</th>
                </tr>
              </thead>
              <tbody>
                {data.recovery.map((r, i) => (
                  <tr key={`${r.party}-${i}`} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{r.party}</div>
                      {r.agent && <div className="text-muted-foreground text-xs">{r.agent}</div>}
                    </td>
                    <td className="py-2 pr-3"><span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', flagTone(r.flag))}>{r.flag}</span></td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums" title={inrFull(r.outstanding)}>{inrCompact(r.outstanding)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-red-600" title={inrFull(r.overdue)}>{r.overdue > 0 ? inrCompact(r.overdue) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.oldestDays > 0 ? `${r.oldestDays}d` : '—'}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{fmtDate(r.lastReceipt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportCard>
    </div>
  );
}
