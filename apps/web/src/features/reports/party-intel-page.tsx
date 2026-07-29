import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Users } from 'lucide-react';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';
import { RankedBars, ReportCard, ReportHeader, ReportSummary } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { usePartyIntel } from './use-reports';

const SEG_COLOR: Record<string, string> = {
  VIP: '#8b5cf6',
  Loyal: '#10b981',
  Active: '#3b82f6',
  'One-time': '#06b6d4',
  'At-risk': '#f59e0b',
  Dormant: '#ef4444',
  'Win-back': '#ec4899',
  'No orders': '#94a3b8',
};
const segTone = (s: string) => {
  switch (s) {
    case 'VIP': return 'bg-violet-50 text-violet-700 ring-violet-600/20';
    case 'Loyal': return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
    case 'Active': return 'bg-blue-50 text-blue-700 ring-blue-600/20';
    case 'At-risk': return 'bg-amber-50 text-amber-700 ring-amber-600/20';
    case 'Dormant': return 'bg-red-50 text-red-700 ring-red-600/20';
    case 'Win-back': return 'bg-pink-50 text-pink-700 ring-pink-600/20';
    default: return 'bg-slate-100 text-slate-600 ring-slate-500/20';
  }
};
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

export function PartyIntelPage() {
  const filters = useReportFilters();
  const { data, isLoading } = usePartyIntel(filters.query);

  return (
    <div className="space-y-5">
      <ReportHeader title="Party Intelligence" subtitle="Who your best parties are, who is slipping, and who to win back." icon={Users} asOf={data?.asOf} />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      {(() => {
        const seg = (name: string) => data?.segments.find((s) => s.name === name)?.value ?? 0;
        return (
          <ReportSummary
            loading={isLoading}
            points={data ? [
              { text: <><strong>{data.concentration?.totalParties ?? 0}</strong> revenue-earning parties; the top <strong>{data.concentration?.topParties ?? 0}</strong> drive <strong>{data.concentration?.topShare != null ? Math.round(data.concentration.topShare * 100) : '—'}%</strong> of revenue.</>, tone: 'info' },
              { text: <><strong>{seg('VIP')}</strong> VIPs contribute <strong>{inrCompact((data.segmentRevenue ?? []).find((s) => s.name === 'VIP')?.value ?? 0)}</strong> — protect these relationships.</>, tone: 'good' },
              { text: <><strong>{seg('At-risk') + seg('Dormant')}</strong> parties are slipping (at-risk or dormant) — worth re-engaging.</>, tone: seg('At-risk') + seg('Dormant') > 0 ? 'warn' : 'good' },
              { text: <><strong>{seg('Win-back')}</strong> high-value parties have gone quiet — prime win-back targets.</>, tone: seg('Win-back') > 0 ? 'bad' : 'good' },
            ] : []}
          />
        );
      })()}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <ReportCard title="Segments">
          {isLoading ? <div className="bg-muted h-[260px] animate-pulse rounded-lg" /> : (
            <>
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data?.segments ?? []} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={88} paddingAngle={2}>
                      {(data?.segments ?? []).map((s) => <Cell key={s.name} fill={SEG_COLOR[s.name] ?? '#94a3b8'} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v} parties`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2">
                {(data?.segments ?? []).map((s) => (
                  <span key={s.name} className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', segTone(s.name))}>
                    <span className="size-2 rounded-full" style={{ background: SEG_COLOR[s.name] ?? '#94a3b8' }} />
                    {s.name} · {s.value}
                  </span>
                ))}
              </div>
              {data?.concentration.topShare != null && (
                <div className="bg-muted/50 mt-3 rounded-lg px-3 py-2 text-sm">
                  Top <strong>{data.concentration.topParties}</strong> parties (10%) drive{' '}
                  <strong className="text-primary">{Math.round(data.concentration.topShare * 100)}%</strong> of all revenue.
                </div>
              )}
              <div className="mt-3">
                <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase">Revenue by segment</p>
                <RankedBars data={data?.segmentRevenue ?? []} />
              </div>
            </>
          )}
        </ReportCard>

        <ReportCard title="Parties — by lifetime revenue">
          {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : (
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-card sticky top-0">
                  <tr className="text-muted-foreground border-b text-left text-xs uppercase tracking-wide">
                    <th className="py-2 pr-3 font-semibold">Party</th>
                    <th className="py-2 pr-3 font-semibold">Segment</th>
                    <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                    <th className="py-2 pr-3 text-right font-semibold">Invoices</th>
                    <th className="py-2 pr-3 text-right font-semibold">Last order</th>
                    <th className="py-2 pr-3 text-right font-semibold">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.parties ?? []).map((p, i) => (
                    <tr key={`${p.party}-${i}`} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{p.party}</div>
                        {p.agent && <div className="text-muted-foreground text-xs">{p.agent}</div>}
                      </td>
                      <td className="py-2 pr-3"><span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', segTone(p.segment))}>{p.segment}</span></td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums" title={inrFull(p.revenue)}>{inrCompact(p.revenue)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.invoices}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{fmtDate(p.lastOrder)}{p.daysSince != null ? <span className="ml-1 text-xs">({p.daysSince}d)</span> : ''}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.outstanding > 0 ? inrCompact(p.outstanding) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ReportCard>
      </div>
    </div>
  );
}
