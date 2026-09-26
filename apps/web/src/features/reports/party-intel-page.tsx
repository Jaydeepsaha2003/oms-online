import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Users } from 'lucide-react';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { initials } from '@/features/crm/crm-shared';
import { RankedBars, ReportCard, ReportChips, ReportDeskHero, ReportDonut, ReportHeader, ReportRow, ReportRowList, ReportSummary, type KpiTone, type Pill, type ReportHero } from './report-kit';
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
    case 'VIP': return 'bg-violet-50 text-violet-700 ring-violet-200';
    case 'Loyal': return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    case 'Active': return 'bg-indigo-50 text-blue-800 ring-indigo-200';
    case 'At-risk': return 'bg-amber-50 text-amber-700 ring-amber-200';
    case 'Dormant': return 'bg-rose-50 text-rose-700 ring-rose-200';
    case 'Win-back': return 'bg-pink-50 text-pink-700 ring-pink-200';
    default: return 'bg-slate-100 text-slate-600 ring-slate-200';
  }
};
const PILL = 'inline-flex items-center rounded-full px-[9px] py-[3px] text-[11.5px] leading-[1.3] font-bold whitespace-nowrap ring-1 ring-inset';
// Follows the system-wide date format (dd-mm-yy by default).
const fmtDate = (d: string | null) => formatDate(d);
// Mirrors segTone above, mapped to a ReportRow pill tone for the mobile card.
const segPillTone = (s: string): Pill['tone'] => {
  switch (s) {
    case 'VIP': return 'violet';
    case 'Loyal': return 'emerald';
    case 'Active': return 'blue';
    case 'At-risk': return 'amber';
    case 'Dormant': return 'rose';
    case 'Win-back': return 'rose';
    default: return 'slate';
  }
};
/** The same mapping as a chip tone, for the mobile segments grid. */
const segChipTone = (s: string): KpiTone => segPillTone(s) as KpiTone;

export function PartyIntelPage() {
  const filters = useReportFilters();
  const { data, isLoading } = usePartyIntel(filters.query);
  const seg = (name: string) => data?.segments.find((s) => s.name === name)?.value ?? 0;
  const segRev = (name: string) => (data?.segmentRevenue ?? []).find((s) => s.name === name)?.value ?? 0;
  const topPct = data?.concentration?.topShare != null ? Math.round(data.concentration.topShare * 100) : null;

  const hero: ReportHero | undefined = data ? {
    label: 'Billed parties',
    value: (data.concentration?.totalParties ?? 0).toLocaleString('en-IN'),
    chip: topPct != null ? { text: `top ${data.concentration.topParties} drive ${topPct}%`, tone: 'neutral' } : undefined,
    hint: 'parties that earned revenue in the selected period',
    stats: [
      { label: 'VIP', value: String(seg('VIP')), hint: `${inrCompact(segRev('VIP'))} revenue`, dot: '#c4b5fd' },
      { label: 'Loyal', value: String(seg('Loyal')), hint: `${inrCompact(segRev('Loyal'))} revenue`, dot: '#6ee7b7' },
      { label: 'Slipping', value: String(seg('At-risk') + seg('Dormant')), hint: 'at-risk or dormant', dot: '#fcd34d' },
      { label: 'Win-back', value: String(seg('Win-back')), hint: 'high value, gone quiet', dot: '#ff8fab' },
    ],
  } : undefined;

  return (
    <div className="rp-page space-y-5">
      <ReportHeader
        title="Party Intelligence"
        subtitle="Who your best parties are, who is slipping, and who to win back."
        icon={Users}
        asOf={data?.asOf}
        hero={data ? {
          label: 'Billed parties',
          value: (data.concentration?.totalParties ?? 0).toLocaleString('en-IN'),
          hint: data.concentration?.topShare != null ? `top ${data.concentration.topParties} drive ${Math.round(data.concentration.topShare * 100)}%` : undefined,
        } : undefined}
      />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportDeskHero hero={hero} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          {
            text: <><strong>{data.concentration?.totalParties ?? 0}</strong> parties earned revenue in the selected period; the top <strong>{data.concentration?.topParties ?? 0}</strong> drive <strong>{topPct ?? '—'}%</strong> of it.</>,
            tone: 'info',
            desk: { value: topPct != null ? `${topPct}%` : '—', text: `Of revenue comes from the top ${data.concentration?.topParties ?? 0} of ${data.concentration?.totalParties ?? 0} billed parties.` },
          },
          {
            text: <><strong>{seg('VIP')}</strong> VIPs contribute <strong>{inrCompact(segRev('VIP'))}</strong> — protect these relationships.</>,
            tone: 'good',
            desk: { value: inrCompact(segRev('VIP')), text: `From ${seg('VIP')} VIP parties. Protect these relationships.` },
          },
          {
            text: <><strong>{seg('At-risk') + seg('Dormant')}</strong> parties are slipping (at-risk or dormant) — worth re-engaging.</>,
            tone: seg('At-risk') + seg('Dormant') > 0 ? 'warn' : 'good',
            desk: { value: `${seg('At-risk') + seg('Dormant')} parties`, text: 'Are slipping (at-risk or dormant). Worth a call.' },
          },
          {
            text: <><strong>{seg('Win-back')}</strong> high-value parties have gone quiet — prime win-back targets.</>,
            tone: seg('Win-back') > 0 ? 'bad' : 'good',
            desk: { value: `${seg('Win-back')} parties`, text: 'High-value parties that have gone quiet. Prime win-back targets.' },
          },
        ] : []}
      />

      <div className="grid gap-[14px] lg:grid-cols-2">
        <ReportCard title="Segments">
          {isLoading ? <div className="bg-muted h-[260px] animate-pulse rounded-lg" /> : (
            <>
              {/* Phone: the pie and the tone chips. */}
              <div className="sm:hidden">
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
                <ReportChips chips={(data?.segments ?? []).map((sg) => ({ label: sg.name, count: String(sg.value), tone: segChipTone(sg.name) }))} />
              </div>
              {/* Desktop: the ring of party counts, its legend two-up. */}
              <div className="hidden sm:block">
                <ReportDonut data={data?.segments ?? []} center="Parties" money={false} cols={2} colorFor={(d) => SEG_COLOR[d.name] ?? '#94a3b8'} />
              </div>
              {data?.concentration.topShare != null && (
                <div className="bg-muted/50 mt-3 rounded-lg px-3 py-2 text-sm sm:mt-4 sm:rounded-xl sm:bg-indigo-50/70 sm:text-[13px] dark:sm:bg-white/5">
                  Top <strong>{data.concentration.topParties}</strong> parties (10%) drive{' '}
                  <strong className="text-primary">{Math.round(data.concentration.topShare * 100)}%</strong> of selected-period revenue.
                </div>
              )}
              <div className="mt-3 sm:mt-4">
                <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase sm:mb-2.5 sm:text-[10.5px] sm:font-extrabold sm:tracking-[0.08em]">Revenue by segment</p>
                <RankedBars data={data?.segmentRevenue ?? []} colorFor={(d) => SEG_COLOR[d.name] ?? '#94a3b8'} />
              </div>
            </>
          )}
        </ReportCard>

        <ReportCard title="Parties by selected-period revenue" right={data ? `${(data.parties ?? []).length} parties` : undefined} flush>
          {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : (
            <>
              <ReportRowList emptyText="No parties in this period.">
                {(data?.parties ?? []).map((p, i) => (
                  <ReportRow
                    key={`${p.party}-${i}`}
                    i={i}
                    title={p.party}
                    sub={p.agent || undefined}
                    pills={[{ text: p.segment, tone: segPillTone(p.segment) }]}
                    stats={[
                      { label: 'Revenue', value: inrCompact(p.revenue) },
                      { label: 'Invoices', value: p.invoices },
                      { label: 'Last order', value: `${fmtDate(p.lastOrder)}${p.daysSince != null ? ` (${p.daysSince}d)` : ''}` },
                      { label: 'Outstanding', value: p.outstanding > 0 ? inrCompact(p.outstanding) : '—', tone: p.outstanding > 0 ? 'bad' : undefined },
                    ]}
                  />
                ))}
              </ReportRowList>
            <div className="hidden max-h-[560px] overflow-auto sm:block">
              <table className="rd-table min-w-[640px]">
                <thead className="sticky top-0 z-[1]">
                  <tr>
                    <th>Party</th>
                    <th>Segment</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Invoices</th>
                    <th className="text-right">Last order</th>
                    <th className="text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.parties ?? []).map((p, i) => (
                    <tr key={`${p.party}-${i}`}>
                      <td>
                        {/* Capped: an auto-sized table otherwise lets a long name push the columns off the card. */}
                        <span className="flex max-w-[220px] min-w-0 items-center gap-2.5">
                          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-[11.5px] font-extrabold ring-1 ring-inset', segTone(p.segment))}>{initials(p.party)}</span>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-[13.5px] leading-tight font-bold">{p.party}</span>
                            {p.agent && <span className="truncate text-[11.5px] leading-tight text-[#7a849c]">{p.agent}</span>}
                          </span>
                        </span>
                      </td>
                      <td><span className={cn(PILL, segTone(p.segment))}>{p.segment}</span></td>
                      <td className="num" title={inrFull(p.revenue)}>{inrCompact(p.revenue)}</td>
                      <td className="num font-semibold">{p.invoices}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">
                        <span className="flex flex-col items-end leading-tight">
                          <span className="text-[12.5px] font-bold">{fmtDate(p.lastOrder)}</span>
                          {p.daysSince != null && <span className="text-[11.5px] text-[#7a849c]">{p.daysSince} days ago</span>}
                        </span>
                      </td>
                      <td className="num">{p.outstanding > 0 ? <span className="text-rose-700 dark:text-rose-400">{inrCompact(p.outstanding)}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </ReportCard>
      </div>
    </div>
  );
}
