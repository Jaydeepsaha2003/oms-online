import { useEffect, useMemo, useState } from 'react';
import { BookText, CalendarClock, FileSpreadsheet, Loader2, Printer, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerReceiptLine, PartyLedgerQuery, PartyLedgerRow } from '@oms/shared';
import { downloadFile, getApiErrorMessage } from '@/lib/api';
import { openPdf } from '@/lib/pdf';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchLedgerReceipts, usePartyLedger, usePartyLedgerLookups } from './use-party-ledger';

const inr = (v: number) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const money = (v: number) => (v ? inr(v) : '');
const prettyDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const FY_START_MONTH = 3; // April (0-based)
function fyStart(d: Date): Date {
  const y = d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, FY_START_MONTH, 1);
}
const RANGE_PRESETS = ['This Year', 'Last Year', 'This Quarter', 'Last Quarter', 'This Month', 'Last Month', 'Yesterday', 'Today'] as const;
type Preset = (typeof RANGE_PRESETS)[number];

function presetRange(p: Preset): { from: Date; to: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fys = fyStart(today);
  const monthsSince = (today.getFullYear() - fys.getFullYear()) * 12 + (today.getMonth() - fys.getMonth());
  const qIdx = Math.max(0, Math.floor(monthsSince / 3));
  const qStart = new Date(fys.getFullYear(), fys.getMonth() + qIdx * 3, 1);
  switch (p) {
    case 'Today':
      return { from: today, to: today };
    case 'Yesterday': {
      const y = new Date(today.getTime() - 86400000);
      return { from: y, to: y };
    }
    case 'This Month':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
    case 'Last Month':
      return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 0) };
    case 'This Quarter':
      return { from: qStart, to: today };
    case 'Last Quarter':
      return { from: new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1), to: new Date(qStart.getTime() - 86400000) };
    case 'Last Year':
      return { from: new Date(fys.getFullYear() - 1, FY_START_MONTH, 1), to: new Date(fys.getTime() - 86400000) };
    case 'This Year':
    default:
      return { from: fys, to: today };
  }
}

export function PartyLedgerPage() {
  const { can } = usePermissions();
  const { data: lookups } = usePartyLedgerLookups();

  const [party, setParty] = useState('');
  const [agent, setAgent] = useState('');
  const [from, setFrom] = useState(ymd(fyStart(new Date())));
  const [to, setTo] = useState(ymd(new Date()));
  const [mode, setMode] = useState<'BOTH' | 'B' | 'C'>('BOTH');
  const [voucherType, setVoucherType] = useState('');
  const [applied, setApplied] = useState<PartyLedgerQuery | null>(null);
  const [receiptFor, setReceiptFor] = useState<PartyLedgerRow | null>(null);

  const custByName = useMemo(() => new Map((lookups?.customers ?? []).map((c) => [c.name, c.id])), [lookups]);
  const partyOptions = useMemo(() => (lookups?.customers ?? []).map((c) => c.name), [lookups]);
  const agentOptions = useMemo(() => ['All', ...(lookups?.agents ?? [])], [lookups]);

  const buildQuery = (): PartyLedgerQuery => ({
    customerId: party ? custByName.get(party) : undefined,
    agentName: !party && agent && agent !== 'All' ? agent : undefined,
    from,
    to,
    mode,
    voucherType: voucherType || undefined,
  });

  // Auto-load on first mount (ALL, this FY) — mirrors the legacy form.
  useEffect(() => {
    setApplied({ from: ymd(fyStart(new Date())), to: ymd(new Date()), mode: 'BOTH' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isFetching } = usePartyLedger(applied);
  const rows = data?.rows ?? [];
  const footer = data?.footer;
  const kpis = data?.kpis;

  const onSearch = () => setApplied(buildQuery());
  const onReset = () => {
    setParty('');
    setAgent('');
    setMode('BOTH');
    setVoucherType('');
    setFrom(ymd(fyStart(new Date())));
    setTo(ymd(new Date()));
    setApplied({ from: ymd(fyStart(new Date())), to: ymd(new Date()), mode: 'BOTH' });
  };
  const applyPreset = (p: string) => {
    if (!RANGE_PRESETS.includes(p as Preset)) return;
    const { from: f, to: t } = presetRange(p as Preset);
    setFrom(ymd(f));
    setTo(ymd(t));
  };

  const exportUrl = (fmt: 'pdf' | 'xlsx') => {
    const q = buildQuery();
    const params = new URLSearchParams();
    if (q.customerId) params.set('customerId', String(q.customerId));
    if (q.agentName) params.set('agentName', q.agentName);
    params.set('from', q.from);
    params.set('to', q.to);
    if (q.mode) params.set('mode', q.mode);
    if (q.voucherType) params.set('voucherType', q.voucherType);
    return `/party-ledger/export.${fmt}?${params.toString()}`;
  };
  const onPdf = () => openPdf(exportUrl('pdf')).catch((e) => toast.error(getApiErrorMessage(e, 'PDF failed')));
  const onExcel = () => downloadFile(exportUrl('xlsx'), 'party-ledger.xlsx').catch((e) => toast.error(getApiErrorMessage(e, 'Export failed')));

  const statusChip = (s: string) => {
    if (s === 'F') return <span className="rounded bg-emerald-100 px-1.5 text-xs font-bold text-emerald-700" title="Fully paid">F</span>;
    if (s === 'P') return <span className="rounded bg-amber-100 px-1.5 text-xs font-bold text-amber-700" title="Partially paid">P</span>;
    if (s === 'D') return <span className="rounded bg-rose-100 px-1.5 text-xs font-bold text-rose-700" title="Due">D</span>;
    return null;
  };
  const dueFromCell = (r: PartyLedgerRow) => {
    const t = r.dueFrom;
    if (!t) return <span className="text-muted-foreground">—</span>;
    const paid = /Early|On Time|Late/i.test(t);
    const over = /Over/i.test(t);
    return <span className={cn('text-xs font-semibold', paid ? 'text-emerald-600' : over ? 'text-rose-600' : 'text-slate-600')}>{t}</span>;
  };

  const isInvoiceRow = (r: PartyLedgerRow) => {
    const vt = r.voucherType.toUpperCase();
    return vt === 'SALES INVOICE' || vt === 'DEBIT NOTE';
  };

  const columns: DataColumn<PartyLedgerRow>[] = [
    { id: 'date', label: 'Date', cell: (r) => <span className="whitespace-nowrap tabular-nums">{prettyDate(r.txnDate)}</span> },
    { id: 'due', label: 'Due From', cell: dueFromCell },
    { id: 'part', label: 'Particulars', cell: (r) => <span className="font-medium">{r.particulars}</span> },
    { id: 'vt', label: 'Voucher Type', cell: (r) => <span className="text-sm">{r.voucherType}</span> },
    {
      id: 'vn',
      label: 'Voucher No',
      cell: (r) => (
        <span className={cn('font-mono text-sm', isInvoiceRow(r) && 'cursor-pointer font-semibold text-blue-600 hover:underline')}>{r.voucherNo}</span>
      ),
    },
    { id: 'st', label: '', cell: (r) => statusChip(r.status) },
    { id: 'bdr', label: 'Bank (Dr.)', align: 'right', cell: (r) => <span className="tabular-nums">{money(r.bankDr)}</span> },
    { id: 'bcr', label: 'Bank (Cr.)', align: 'right', cell: (r) => <span className="tabular-nums text-emerald-700">{money(r.bankCr)}</span> },
    { id: 'cdr', label: 'Cash (Dr.)', align: 'right', cell: (r) => <span className="tabular-nums">{money(r.cashDr)}</span> },
    { id: 'ccr', label: 'Cash (Cr.)', align: 'right', cell: (r) => <span className="tabular-nums text-emerald-700">{money(r.cashCr)}</span> },
  ];
  const visibleCols = columns.filter((c) => (mode === 'B' ? c.id !== 'cdr' && c.id !== 'ccr' : mode === 'C' ? c.id !== 'bdr' && c.id !== 'bcr' : true));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <BookText className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Party Ledger</h2>
          <p className="text-muted-foreground text-sm">Tally-style statement — opening, every voucher, running Dr/Cr, aging & closing balance.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {can('partyledger:print') && (
            <Button variant="outline" size="sm" onClick={onPdf} disabled={!rows.length}>
              <Printer /> PDF
            </Button>
          )}
          {can('partyledger:export') && (
            <Button variant="outline" size="sm" onClick={onExcel} disabled={!rows.length}>
              <FileSpreadsheet /> Excel
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card grid grid-cols-2 gap-3 rounded-md border p-3 shadow-sm md:grid-cols-4 lg:grid-cols-6">
        <div className="col-span-2 space-y-1">
          <Label className="text-sm">Customer</Label>
          <NativeSelect value={party} onChange={(v) => { setParty(v); if (v) setAgent(''); }} options={['', ...partyOptions]} placeholder="All customers" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Agent</Label>
          <NativeSelect value={agent} onChange={(v) => { setAgent(v); if (v && v !== 'All') setParty(''); }} options={agentOptions} placeholder="All" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Quick Range</Label>
          <NativeSelect value="" onChange={applyPreset} options={['', ...RANGE_PRESETS]} placeholder="Preset…" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Voucher Type</Label>
          <NativeSelect value={voucherType} onChange={setVoucherType} options={['', ...(data?.voucherTypes ?? [])]} placeholder="All" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Transaction</Label>
          <div className="bg-muted inline-flex items-center gap-0.5 rounded-md p-0.5">
            {(['BOTH', 'B', 'C'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn('rounded px-3 py-1 text-xs font-semibold transition-colors', mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {m === 'BOTH' ? 'Both' : m === 'B' ? 'Bank' : 'Cash'}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-2 flex items-end gap-2 md:col-span-2 lg:col-span-3">
          <Button onClick={onSearch} disabled={isFetching}>
            {isFetching ? <Loader2 className="animate-spin" /> : <Search />} Search
          </Button>
          <Button variant="outline" onClick={onReset}>
            <X /> Reset
          </Button>
          {data && (
            <span className="text-muted-foreground ml-auto self-center text-sm">
              {data.scope === 'CUSTOMER' ? data.customerName : data.scope === 'AGENT' ? `Agent: ${data.agentName}` : 'All parties'} · {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
            </span>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Inv Due From" value={kpis?.invDueFrom ?? '—'} icon />
        <KpiCard label="Payment DNA" value={kpis?.paymentDNA ?? '—'} tone={dnaTone(kpis?.paymentDNA)} />
        <KpiCard label="Over Due" value={kpis ? `${inr(kpis.overDue.amount)} (${kpis.overDue.count})` : '—'} tone="rose" />
        <KpiCard label="Past Due" value={kpis ? `${inr(kpis.pastDue.amount)} (${kpis.pastDue.count})` : '—'} tone="amber" />
        <KpiCard label="Normal Due" value={kpis ? `${inr(kpis.normal.amount)} (${kpis.normal.count})` : '—'} tone="emerald" />
      </div>

      {/* Ledger */}
      <DataTable
        columns={visibleCols}
        rows={rows}
        rowKey={(r) => String(rows.indexOf(r))}
        isLoading={isFetching && !data}
        emptyText="No ledger entries for these filters."
        onRowClick={(r) => isInvoiceRow(r) && setReceiptFor(r)}
      />

      {/* Footer totals */}
      {footer && (
        <div className="bg-emerald-50 overflow-x-auto rounded-md border border-emerald-200">
          <table className="w-full text-sm">
            <tbody className="[&_td]:px-3 [&_td]:py-2 [&_td]:tabular-nums">
              {(
                [
                  ['Opening Balance', footer.opening],
                  ['Current Total', footer.current],
                  ['Closing Balance', footer.closing],
                ] as const
              ).map(([label, b], i) => (
                <tr key={label} className={cn('border-t border-emerald-200 font-semibold', i === 2 && 'bg-emerald-100')}>
                  <td className="text-right">{label}</td>
                  {mode !== 'C' && <td className="text-right">{money(b.bankDr)}</td>}
                  {mode !== 'C' && <td className="text-right text-emerald-700">{money(b.bankCr)}</td>}
                  {mode !== 'B' && <td className="text-right">{money(b.cashDr)}</td>}
                  {mode !== 'B' && <td className="text-right text-emerald-700">{money(b.cashCr)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReceiptDialog row={receiptFor} onClose={() => setReceiptFor(null)} />
    </div>
  );
}

function dnaTone(v?: string): Tone {
  switch (v) {
    case 'Excellent':
    case 'Good':
      return 'emerald';
    case 'Normal':
      return 'slate';
    case 'Slow':
      return 'amber';
    case 'Bad':
      return 'rose';
    default:
      return 'slate';
  }
}
type Tone = 'slate' | 'rose' | 'amber' | 'emerald';
const toneCls: Record<Tone, string> = {
  slate: 'text-slate-800',
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  emerald: 'text-emerald-600',
};

function KpiCard({ label, value, tone = 'slate', icon }: { label: string; value: string; tone?: Tone; icon?: boolean }) {
  return (
    <div className="bg-card rounded-md border p-3 shadow-sm">
      <div className="text-muted-foreground flex items-center gap-1 text-xs font-semibold uppercase tracking-wide">
        {icon && <CalendarClock className="size-3.5" />}
        {label}
      </div>
      <div className={cn('mt-1 truncate text-lg font-bold tabular-nums', toneCls[tone])} title={value}>
        {value}
      </div>
    </div>
  );
}

function ReceiptDialog({ row, onClose }: { row: PartyLedgerRow | null; onClose: () => void }) {
  const [lines, setLines] = useState<LedgerReceiptLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!row) return;
    setLoading(true);
    setLines(null);
    fetchLedgerReceipts(row.voucherNo)
      .then(setLines)
      .catch(() => setLines([]))
      .finally(() => setLoading(false));
  }, [row]);

  const verb = (t: string) => (t === 'CREDIT NOTE' ? 'Cleared' : t === 'ADVANCE' ? 'Adjusted' : 'Paid');
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {row?.voucherType} — <span className="font-mono">{row?.voucherNo}</span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground -mt-2 text-sm">{row?.particulars}</p>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading receipts…
          </div>
        ) : lines && lines.length ? (
          <ul className="space-y-1.5 py-1 text-sm">
            {lines.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-500" />
                {verb(l.recType)} on {prettyDate(l.recDate)} vide <span className="font-mono font-semibold">{l.refRecId || '?'}</span>
                {l.recAmt > 0 && <span className="ml-auto tabular-nums font-semibold">₹ {inr(l.recAmt)}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">No payments / clearances recorded yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
