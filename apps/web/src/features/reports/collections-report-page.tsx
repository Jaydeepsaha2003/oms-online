import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { AlertTriangle, HandCoins, PhoneCall } from 'lucide-react';
import type { PromiseState, RecoveryStage } from '@oms/shared';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kpi, RankedBars, ReportCard, ReportHeader, ReportSummary } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useCollectionsReport } from './use-reports';

const flagTone = (flag: string) => {
  if (flag.includes('60+')) return 'bg-red-50 text-red-700 ring-red-600/20';
  if (flag.includes('30')) return 'bg-orange-50 text-orange-700 ring-orange-600/20';
  if (flag.startsWith('CALL')) return 'bg-amber-50 text-amber-700 ring-amber-600/20';
  if (flag === 'WATCH') return 'bg-slate-100 text-slate-600 ring-slate-500/20';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
};
const STAGE_TONE: Record<RecoveryStage, string> = {
  'Promise broken': 'bg-red-50 text-red-700 ring-red-600/20',
  'Callback due': 'bg-orange-50 text-orange-700 ring-orange-600/20',
  'Not contacted': 'bg-slate-100 text-slate-600 ring-slate-500/20',
  'In progress': 'bg-blue-50 text-blue-700 ring-blue-600/20',
  Promised: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  Resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
};
const promiseTone = (s: PromiseState) => (s === 'broken' ? 'text-red-600' : s === 'due today' ? 'text-orange-600' : s === 'upcoming' ? 'text-violet-600' : 'text-muted-foreground');
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

export function CollectionsReportPage() {
  const filters = useReportFilters();
  const { data, isLoading } = useCollectionsReport(filters.query);

  return (
    <div className="space-y-5">
      <ReportHeader title="Collections & Recovery" subtitle="How much is owed, how old it is, and who to chase first." icon={HandCoins} asOf={data?.asOf} />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          { text: <>Total outstanding is <strong>{inrCompact(data.totalOutstanding)}</strong>, of which <strong>{inrCompact(data.overdue)}</strong>{data.totalOutstanding > 0 && <> ({Math.round((data.overdue / data.totalOutstanding) * 100)}%)</>} is overdue.</>, tone: data.overdue > 0 ? 'bad' : 'good' },
          { text: <><strong>{inrCompact(data.dueSoon)}</strong> falls due in the next 15 days — get ahead of it.</>, tone: 'warn' },
          { text: <><strong>{data.recovery.filter((r) => r.rank <= 3).length}</strong> parties need a call now; <strong>{data.recovery[0]?.party ?? '—'}</strong> tops the list at <strong>{inrCompact(data.recovery[0]?.outstanding ?? 0)}</strong>.</>, tone: 'bad' },
          ...(data.recoveryKpis.promisedValue > 0 ? [{ text: <><strong>{inrCompact(data.recoveryKpis.promisedValue)}</strong> is promised-to-pay across {data.recoveryKpis.promisedParties} parties — expected in.</>, tone: 'good' as const }] : []),
          ...(data.recoveryKpis.promisesOverdue > 0 ? [{ text: <><strong>{data.recoveryKpis.promisesOverdue}</strong> parties broke their promise ({inrCompact(data.recoveryKpis.brokenPromiseValue)}) — chase these first.</>, tone: 'bad' as const }] : []),
          { text: <><strong>{data.recoveryKpis.neverContacted}</strong> owing parties have no follow-up yet — start working them.</>, tone: data.recoveryKpis.neverContacted > 0 ? 'warn' : 'good' },
          { text: <>Collection efficiency is <strong>{data.collectionRate != null ? Math.round(data.collectionRate * 100) : '—'}%</strong> this FY (DSO {data.dsoDays ?? '—'} days).</>, tone: 'info' },
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

      {/* Recovery CRM KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Kpi label="Collection rate" value={data?.collectionRate != null ? `${Math.round(data.collectionRate * 100)}%` : '—'} hint="collected ÷ billed (FY)" loading={isLoading} tone="emerald" />
        <Kpi label="DSO" value={data?.dsoDays != null ? `${data.dsoDays}d` : '—'} hint="days sales outstanding" loading={isLoading} tone="slate" />
        <Kpi label="Promised to pay" value={data ? inrCompact(data.recoveryKpis.promisedValue) : '—'} title={data ? inrFull(data.recoveryKpis.promisedValue) : undefined} hint={data ? `${data.recoveryKpis.promisedParties} parties` : undefined} loading={isLoading} tone="violet" />
        <Kpi label="Broken promises" value={data ? inrCompact(data.recoveryKpis.brokenPromiseValue) : '—'} title={data ? inrFull(data.recoveryKpis.brokenPromiseValue) : undefined} hint={data ? `${data.recoveryKpis.promisesOverdue} parties` : undefined} loading={isLoading} tone="rose" />
        <Kpi label="Promises due today" value={data ? String(data.recoveryKpis.promisesDueToday) : '—'} hint="follow up now" loading={isLoading} tone="amber" />
        <Kpi label="Never contacted" value={data ? String(data.recoveryKpis.neverContacted) : '—'} hint="owing, no follow-up" loading={isLoading} tone="blue" />
      </div>

      {/* Recovery pipeline */}
      <ReportCard title="Recovery pipeline" right={<Button asChild variant="outline" size="sm"><Link to="/crm/payments"><PhoneCall className="size-3.5" /> Work follow-ups</Link></Button>}>
        {isLoading ? <div className="bg-muted h-16 animate-pulse rounded" /> : !data?.pipeline.length ? (
          <div className="text-muted-foreground py-4 text-center text-sm">No owing parties.</div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {data.pipeline.map((s) => (
              <div key={s.stage} className={cn('rounded-lg px-3 py-2 ring-1 ring-inset', STAGE_TONE[s.stage])}>
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{s.stage}</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums">{s.parties}</div>
                <div className="text-xs tabular-nums opacity-80" title={inrFull(s.value)}>{inrCompact(s.value)}</div>
              </div>
            ))}
          </div>
        )}
      </ReportCard>

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

      <ReportCard title="Collections trend — last 12 months">
        {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : (
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.collectionTrend ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="collGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => inrCompact(v)} />
                <Tooltip formatter={(v: number) => [inrFull(v), 'Collected']} cursor={{ stroke: '#94a3b8' }} />
                <Area type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2.5} fill="url(#collGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportCard>

      <ReportCard title="Recovery call list — highest priority first">
        {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : !data?.recovery.length ? (
          <div className="text-muted-foreground py-8 text-center text-sm">Nothing to chase — you're all clear. 🎉</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs uppercase tracking-wide">
                  <th className="py-2 pr-3 font-semibold">Party</th>
                  <th className="py-2 pr-3 font-semibold">Priority</th>
                  <th className="py-2 pr-3 font-semibold">Recovery stage</th>
                  <th className="py-2 pr-3 text-right font-semibold">Outstanding</th>
                  <th className="py-2 pr-3 text-right font-semibold">Overdue</th>
                  <th className="py-2 pr-3 text-right font-semibold">Oldest</th>
                  <th className="py-2 pr-3 font-semibold">Next promise</th>
                  <th className="py-2 pr-3 font-semibold">Last contact</th>
                  <th className="py-2 pr-3 text-right font-semibold">Action</th>
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
                    <td className="py-2 pr-3">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', STAGE_TONE[r.stage])}>
                        {r.stage === 'Promise broken' && <AlertTriangle className="size-3" />}
                        {r.stage}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums" title={inrFull(r.outstanding)}>{inrCompact(r.outstanding)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-red-600" title={inrFull(r.overdue)}>{r.overdue > 0 ? inrCompact(r.overdue) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.oldestDays > 0 ? `${r.oldestDays}d` : '—'}</td>
                    <td className={cn('py-2 pr-3 whitespace-nowrap', promiseTone(r.promiseState))}>
                      {r.nextPromiseAt ? (
                        <>{fmtDate(r.nextPromiseAt)}{r.nextPromiseAmount != null && r.nextPromiseAmount > 0 && <span className="font-semibold"> · {inrCompact(r.nextPromiseAmount)}</span>}</>
                      ) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.lastContactAt ? `${fmtDate(r.lastContactAt)}${r.daysSinceContact != null ? ` · ${r.daysSinceContact}d` : ''}` : 'never'}</td>
                    <td className="py-2 pr-3 text-right">
                      <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
                        <Link to={`/crm/payments?party=${encodeURIComponent(r.party)}`}>Follow up</Link>
                      </Button>
                    </td>
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
