import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, HandCoins, PhoneCall } from 'lucide-react';
import type { PromiseState, RecoveryStage } from '@oms/shared';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { initials } from '@/features/crm/crm-shared';
import {
  BAR_RADIUS,
  CHART_GRID,
  CHART_TICK,
  ChartLegend,
  DESK_BANK,
  DESK_CASH,
  Kpi,
  KpiGrid,
  RankedBars,
  ReportCard,
  ReportChips,
  ReportDeskHero,
  ReportHeader,
  ReportRow,
  ReportRowList,
  ReportSummary,
  type KpiTone,
  type Pill,
  type ReportHero,
} from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useCollectionsReport } from './use-reports';

/**
 * Never let a money field the server did not send reach a formatter — a browser
 * running ahead of the API would otherwise print "₹NaN" across the screen.
 */
const money = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);

const flagTone = (flag: string) => {
  if (flag.includes('60+')) return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (flag.includes('30')) return 'bg-orange-50 text-orange-700 ring-orange-200';
  if (flag.startsWith('CALL')) return 'bg-amber-50 text-amber-700 ring-amber-200';
  // Not a chase — their own money is already with us and needs allocating.
  if (flag === 'ADJUST ADVANCE') return 'bg-indigo-50 text-indigo-700 ring-indigo-200';
  if (flag === 'WATCH') return 'bg-slate-100 text-slate-600 ring-slate-200';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
};
const STAGE_TONE: Record<RecoveryStage, string> = {
  'Promise broken': 'bg-rose-50 text-rose-700 ring-rose-200',
  'Callback due': 'bg-amber-50 text-amber-700 ring-amber-200',
  'Not contacted': 'bg-slate-100 text-slate-600 ring-slate-200',
  'In progress': 'bg-indigo-50 text-blue-800 ring-indigo-200',
  Promised: 'bg-violet-50 text-violet-700 ring-violet-200',
  Resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};
const PILL = 'inline-flex items-center gap-1 rounded-full px-[9px] py-[3px] text-[11.5px] leading-[1.3] font-bold whitespace-nowrap ring-1 ring-inset';
const promiseTone = (s: PromiseState) => (s === 'broken' ? 'text-rose-700' : s === 'due today' ? 'text-orange-600' : s === 'upcoming' ? 'text-violet-600' : 'text-muted-foreground');
// Same buckets as flagTone/STAGE_TONE above, mapped to a ReportRow pill tone
// instead of a Tailwind class string — the mobile card and the desktop table
// row read the same flag the same way.
const flagPillTone = (flag: string): Pill['tone'] => {
  if (flag.includes('60+')) return 'rose';
  if (flag.includes('30')) return 'amber';
  if (flag.startsWith('CALL')) return 'amber';
  if (flag === 'ADJUST ADVANCE') return 'violet';
  if (flag === 'WATCH') return 'slate';
  return 'emerald';
};
const STAGE_PILL_TONE: Record<RecoveryStage, Pill['tone']> = {
  'Promise broken': 'rose', 'Callback due': 'amber', 'Not contacted': 'slate', 'In progress': 'blue', Promised: 'violet', Resolved: 'emerald',
};
// Follows the system-wide date format (dd-mm-yy by default).
const fmtDate = (d: string | null) => formatDate(d);

export function CollectionsReportPage() {
  const navigate = useNavigate();
  const filters = useReportFilters();
  const { data, isLoading } = useCollectionsReport(filters.query);
  const rk = data?.recoveryKpis;
  const overduePct = data && data.totalOutstanding > 0 ? Math.round((money(data.overdue) / data.totalOutstanding) * 100) : 0;
  const modes = data?.collectedModes ?? [];
  const cashPct = Math.round(((modes.find((m) => m.name === 'Cash')?.value ?? 0) / (modes.reduce((t, m) => t + m.value, 0) || 1)) * 100);
  const callNow = (data?.recovery ?? []).filter((r) => r.rank <= 3).length;

  const hero: ReportHero | undefined = data ? {
    label: 'Total outstanding',
    value: inrCompact(money(data.totalOutstanding)),
    chip: { text: `${overduePct}% overdue`, tone: overduePct > 0 ? 'bad' : 'good' },
    hint: `${inrCompact(money(data.overdue))} of it past due${data.advanceHeld > 0 ? ` · net of ${inrCompact(money(data.advanceHeld))} advances` : ''}`,
    bar: { pct: overduePct, label: 'of the book is overdue' },
    stats: [
      { label: 'Overdue', value: inrCompact(data.overdue), hint: 'past due date', dot: '#ff8fab' },
      { label: 'Due soon', value: inrCompact(data.dueSoon), hint: 'next 15 days', dot: '#fcd34d' },
      { label: 'Advance held', value: inrCompact(data.advanceHeld), hint: 'money in hand', dot: '#6ee7b7' },
      { label: 'Collection rate', value: data.collectionRate != null ? `${Math.round(data.collectionRate * 100)}%` : '—', hint: data.dsoDays != null ? `DSO ${data.dsoDays} days` : undefined, dot: '#7dd3fc' },
    ],
  } : undefined;

  return (
    <div className="rp-page space-y-5">
      <ReportHeader
        title="Collections & Recovery"
        subtitle="How much is owed, how old it is, and who to chase first."
        icon={HandCoins}
        asOf={data?.asOf}
        hero={data ? { label: 'Total outstanding', value: inrCompact(money(data.totalOutstanding)), hint: `${inrCompact(money(data.overdue))} of it past due` } : undefined}
      />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportDeskHero hero={hero} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          {
            text: <>Parties owe <strong>{inrCompact(money(data.totalOutstanding))}</strong>, of which <strong>{inrCompact(money(data.overdue))}</strong>{data.totalOutstanding > 0 && <> ({overduePct}%)</>} is past its due date.</>,
            tone: data.overdue > 0 ? 'bad' : 'good',
            desk: { value: inrCompact(money(data.overdue)), text: `Past its due date. That is ${overduePct}% of the ${inrCompact(money(data.totalOutstanding))} outstanding.` },
          },
          {
            text: <><strong>{inrCompact(data.dueSoon)}</strong> falls due in the next 15 days — get ahead of it.</>,
            tone: 'warn',
            desk: { value: inrCompact(data.dueSoon), text: 'Falls due in the next 15 days. Remind these parties before it turns overdue.' },
          },
          {
            text: <><strong>{callNow}</strong> parties need a call now; <strong>{data.recovery?.[0]?.party ?? '—'}</strong> tops the list at <strong>{inrCompact(money(data.recovery?.[0]?.outstanding))}</strong>.</>,
            tone: 'bad',
            desk: { value: `${callNow} parties`, text: `Need a call today. ${data.recovery?.[0]?.party ?? '—'} tops the list at ${inrCompact(money(data.recovery?.[0]?.outstanding))}.` },
          },
          ...((rk?.promisedValue ?? 0) > 0 ? [{
            text: <><strong>{inrCompact(rk!.promisedValue)}</strong> is promised-to-pay across {rk!.promisedParties} parties — expected in.</>,
            tone: 'good' as const,
            desk: { value: inrCompact(rk!.promisedValue), text: `Promised by ${rk!.promisedParties} parties and expected in.` },
          }] : []),
          ...((rk?.promisesOverdue ?? 0) > 0 ? [{
            text: <><strong>{rk!.promisesOverdue}</strong> parties broke their promise ({inrCompact(rk!.brokenPromiseValue)}) — chase these first.</>,
            tone: 'bad' as const,
            desk: { value: `${rk!.promisesOverdue} parties`, text: `Broke a payment promise worth ${inrCompact(rk!.brokenPromiseValue)}. Chase these first.` },
          }] : []),
          {
            text: <><strong>{rk?.neverContacted ?? 0}</strong> of <strong>{data.owingParties}</strong> owing parties have no follow-up. This includes <strong>{data.olderOwingParties}</strong> parties not billed in the selected period.</>,
            tone: (rk?.neverContacted ?? 0) > 0 ? 'warn' : 'good',
            desk: { value: `${rk?.neverContacted ?? 0} parties`, text: `Owe money with no follow-up set. ${data.olderOwingParties} of them were not billed this period.` },
          },
          {
            text: <>Collection efficiency is <strong>{data.collectionRate != null ? Math.round(data.collectionRate * 100) : '—'}%</strong> in the selected period (DSO {data.dsoDays ?? '—'} days).</>,
            tone: 'info',
            desk: { value: data.collectionRate != null ? `${Math.round(data.collectionRate * 100)}%` : '—', text: `Collected of what was billed this period. It takes ${data.dsoDays ?? '—'} days to collect on average.` },
          },
          {
            text: <>Collections in the selected period are <strong>{cashPct}%</strong> cash vs bank.</>,
            tone: 'info',
            desk: { value: `${cashPct}% cash`, text: 'Of this period’s collections came in as cash; the rest through the bank.' },
          },
          ...(data.advanceHeld > 0 ? [{
            text: <><strong>{inrCompact(money(data.advanceHeld))}</strong> of party money is held as advances — already applied to the balances above. Allocate it against the open bills to clear them off the books.</>,
            tone: 'info' as const,
            desk: { value: inrCompact(money(data.advanceHeld)), text: 'Held as party advances, already netted off above. Allocate it against the open bills.' },
          }] : []),
        ] : []}
      />

      {/* The desktop hero carries these four; the phone lists them. */}
      <KpiGrid deskHidden className="gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Every money tile on this page is a NET balance — what the parties
            actually owe once their own advances are applied. The gross invoice
            total lives on hover, not on the face of the card: it is background
            for a query, not the number anyone acts on. */}
        <Kpi
          label="Total outstanding"
          value={data ? inrCompact(money(data.totalOutstanding)) : '—'}
          title={data && data.advanceHeld > 0 ? `${inrFull(money(data.totalOutstanding))} owed — ${inrFull(money(data.grossOutstanding))} invoiced, less ${inrFull(money(data.advanceHeld))} of their own advances` : data ? inrFull(money(data.totalOutstanding)) : undefined}
          hint="net receivable"
          loading={isLoading}
          tone="rose"
        />
        <Kpi label="Overdue" value={data ? inrCompact(data.overdue) : '—'} title={data ? inrFull(data.overdue) : undefined} hint="past due date" loading={isLoading} tone="amber" />
        <Kpi label="Due soon" value={data ? inrCompact(data.dueSoon) : '—'} title={data ? inrFull(data.dueSoon) : undefined} hint="next 15 days" loading={isLoading} tone="blue" />
        <Kpi label="Advance held" value={data ? inrCompact(data.advanceHeld) : '—'} title={data ? inrFull(data.advanceHeld) : undefined} hint="money in hand" loading={isLoading} tone="emerald" />
      </KpiGrid>

      {/* Recovery CRM KPIs — the desktop KPI strip. */}
      <KpiGrid className="gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Kpi label="Collection rate" value={data?.collectionRate != null ? `${Math.round(data.collectionRate * 100)}%` : '—'} hint="collected ÷ billed (period)" loading={isLoading} tone="emerald" deskHidden />
        <Kpi label="Promised to pay" value={data ? inrCompact(rk?.promisedValue ?? 0) : '—'} title={data ? inrFull(rk?.promisedValue ?? 0) : undefined} hint={data ? `${rk?.promisedParties ?? 0} parties` : undefined} loading={isLoading} tone="violet" />
        <Kpi label="Broken promises" value={data ? inrCompact(rk?.brokenPromiseValue ?? 0) : '—'} title={data ? inrFull(rk?.brokenPromiseValue ?? 0) : undefined} hint={data ? `${rk?.promisesOverdue ?? 0} parties` : undefined} loading={isLoading} tone="rose" />
        <Kpi label="Promises due today" value={data ? String(rk?.promisesDueToday ?? 0) : '—'} hint="follow up now" loading={isLoading} tone="amber" />
        <Kpi label="Never contacted" value={data ? String(rk?.neverContacted ?? 0) : '—'} hint="owing, no follow-up" loading={isLoading} tone="blue" />
        <Kpi label="DSO" value={data?.dsoDays != null ? `${data.dsoDays}d` : '—'} hint="days sales outstanding" loading={isLoading} tone="slate" />
      </KpiGrid>

      {/* Recovery pipeline */}
      <ReportCard title="Recovery pipeline" right={<Link to="/crm/payments" className="rd-btn"><PhoneCall className="size-3.5" /> Work follow-ups →</Link>}>
        {isLoading ? <div className="bg-muted h-16 animate-pulse rounded" /> : !data?.pipeline?.length ? (
          <div className="text-muted-foreground py-4 text-center text-sm">No owing parties.</div>
        ) : (
          <ReportChips
            unit="parties"
            chips={data.pipeline.map((s) => ({
              label: s.stage,
              count: String(s.parties),
              value: inrCompact(s.value),
              tone: STAGE_PILL_TONE[s.stage] as KpiTone,
            }))}
          />
        )}
      </ReportCard>

      <div className="grid gap-[14px] lg:grid-cols-2">
      <ReportCard title="Overdue by age">
        {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : (
          <>
          <ChartLegend items={[{ label: 'Bank', color: DESK_BANK }, { label: 'Cash', color: DESK_CASH }]} />
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.aging ?? []} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="24%">
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: '#dfe4ee' }} />
                <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => inrCompact(v)} />
                <Tooltip
                  formatter={(v: number, dataKey) => [inrFull(v), dataKey === 'bank' ? 'Bank' : 'Cash']}
                  labelFormatter={(label, pl) => {
                    const row = pl?.[0]?.payload as { parties?: number; value?: number } | undefined;
                    return `${label} · ${inrFull(money(row?.value))} · ${row?.parties ?? 0} part${row?.parties === 1 ? 'y' : 'ies'}`;
                  }}
                  cursor={{ fill: 'rgba(79,110,247,0.06)' }}
                />
                {/* Bank sits at the bottom of the stack, so it keeps the square
                    foot and Cash carries the rounded cap. */}
                <Bar name="Bank" dataKey="bank" stackId="age" fill={DESK_BANK} maxBarSize={48} />
                <Bar name="Cash" dataKey="cash" stackId="age" fill={DESK_CASH} radius={BAR_RADIUS} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          </>
        )}
      </ReportCard>
        <ReportCard title="Top overdue parties">{isLoading ? <div className="bg-muted h-44 animate-pulse rounded-lg" /> : <RankedBars data={(data?.topOverdueParties ?? []).slice(0, 10)} emptyText="Nothing overdue." />}</ReportCard>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
      <ReportCard title="Collections trend, last 12 months">
        {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : (
          <>
          <ChartLegend items={[{ label: 'Bank', color: DESK_BANK }, { label: 'Cash', color: DESK_CASH }]} />
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.collectionTrend ?? []} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: '#dfe4ee' }} />
                <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => inrCompact(v)} />
                <Tooltip formatter={(v: number, name) => [inrFull(v), name]} cursor={{ fill: 'rgba(79,110,247,0.06)' }} />
                <Bar name="Bank" dataKey="collectedBank" stackId="collected" fill={DESK_BANK} maxBarSize={22} />
                <Bar name="Cash" dataKey="collectedCash" stackId="collected" fill={DESK_CASH} radius={BAR_RADIUS} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          </>
        )}
      </ReportCard>
        <ReportCard title="Collected by mode" right={modes.length ? `${cashPct}% cash` : undefined}>
          {isLoading ? <div className="bg-muted h-44 animate-pulse rounded-lg" /> : <RankedBars data={modes} emptyText="No receipts in this period." colorFor={(d) => (/cash/i.test(d.name) ? DESK_CASH : DESK_BANK)} />}
        </ReportCard>
      </div>

      <ReportCard title="Recovery call list, highest priority first" right={data?.recovery?.length ? `${data.recovery.length} parties` : undefined} flush>
        {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : !data?.recovery?.length ? (
          <div className="text-muted-foreground py-8 text-center text-sm">Nothing to chase — you're all clear. 🎉</div>
        ) : (
          <>
            <ReportRowList>
              {data.recovery.map((r, i) => (
                <ReportRow
                  key={`${r.party}-${i}`}
                  i={i}
                  title={r.party}
                  sub={r.agent || undefined}
                  pills={[{ text: r.flag, tone: flagPillTone(r.flag) }, { text: r.stage, tone: STAGE_PILL_TONE[r.stage] }]}
                  stats={[
                    { label: 'Outstanding', value: inrCompact(money(r.outstanding)) },
                    { label: 'Overdue', value: r.overdue > 0 ? inrCompact(r.overdue) : '—', tone: r.overdue > 0 ? 'bad' : 'muted' },
                    { label: 'Oldest', value: r.oldestDays > 0 ? `${r.oldestDays}d` : '—' },
                    {
                      label: 'Next promise',
                      value: r.nextPromiseAt ? `${fmtDate(r.nextPromiseAt)}${r.nextPromiseAmount != null && r.nextPromiseAmount > 0 ? ` · ${inrCompact(r.nextPromiseAmount)}` : ''}` : '—',
                      tone: r.promiseState === 'broken' ? 'bad' : undefined,
                    },
                    { label: 'Last contact', value: r.lastContactAt ? `${fmtDate(r.lastContactAt)}${r.daysSinceContact != null ? ` · ${r.daysSinceContact}d` : ''}` : 'never' },
                    { label: 'Advance', value: (r.advance ?? 0) > 0 ? inrCompact(money(r.advance)) : '—', tone: (r.advance ?? 0) > 0 ? 'good' : undefined },
                  ]}
                  action={{ label: 'Follow up', onClick: () => navigate(`/crm/payments?party=${encodeURIComponent(r.party)}`) }}
                />
              ))}
            </ReportRowList>
          <div className="hidden max-h-[620px] overflow-auto sm:block">
            <table className="rd-table min-w-[1040px]">
              <thead className="sticky top-0 z-[1]">
                <tr>
                  <th>Party</th>
                  <th>Priority</th>
                  <th>Stage</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-right">Overdue</th>
                  <th>Next promise</th>
                  <th>Last contact</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.recovery.map((r, i) => (
                  <tr key={`${r.party}-${i}`}>
                    <td>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-[11.5px] font-extrabold ring-1 ring-inset', flagTone(r.flag))}>{initials(r.party)}</span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[13.5px] leading-tight font-bold">{r.party}</span>
                          {r.agent && <span className="truncate text-[11.5px] leading-tight text-[#7a849c]">{r.agent}</span>}
                        </span>
                      </span>
                    </td>
                    <td><span className={cn(PILL, flagTone(r.flag))}>{r.flag}</span></td>
                    <td>
                      <span className={cn(PILL, STAGE_TONE[r.stage])}>
                        {r.stage === 'Promise broken' && <AlertTriangle className="size-3" />}
                        {r.stage}
                      </span>
                    </td>
                    <td
                      className="num text-[13.5px]"
                      title={(r.advance ?? 0) > 0 ? `${inrFull(money(r.outstanding))} owed — ${inrFull(money(r.gross))} invoiced, less ${inrFull(money(r.advance))} advance` : inrFull(money(r.outstanding))}
                    >
                      {inrCompact(money(r.outstanding))}
                    </td>
                    <td className="num text-[13.5px]" title={inrFull(r.overdue)}>
                      <span className="flex flex-col items-end leading-tight">
                        <span className={r.overdue > 0 ? 'text-rose-700 dark:text-rose-400' : undefined}>{r.overdue > 0 ? inrCompact(r.overdue) : '—'}</span>
                        {r.oldestDays > 0 && <span className="text-[11.5px] font-normal text-[#7a849c]">{r.oldestDays} days</span>}
                      </span>
                    </td>
                    <td className={cn('text-[12.5px] font-bold whitespace-nowrap tabular-nums', promiseTone(r.promiseState))}>
                      {r.nextPromiseAt ? (
                        <>{fmtDate(r.nextPromiseAt)}{r.nextPromiseAmount != null && r.nextPromiseAmount > 0 && <> · {inrCompact(r.nextPromiseAmount)}</>}</>
                      ) : '—'}
                    </td>
                    <td className="text-[12.5px] whitespace-nowrap text-[#5b6479] tabular-nums dark:text-[#93a6c9]">{r.lastContactAt ? `${fmtDate(r.lastContactAt)}${r.daysSinceContact != null ? ` · ${r.daysSinceContact}d` : ''}` : 'never'}</td>
                    <td className="text-right">
                      <Link to={`/crm/payments?party=${encodeURIComponent(r.party)}`} className="rd-btn">Follow up</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </ReportCard>
    </div>
  );
}
