import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  HandCoins,
  Landmark,
  Loader2,
  RotateCcw,
  Save,
  ScrollText,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PendingInvoiceRow, SavePaymentResult } from '@oms/shared';
import { cn } from '@/lib/utils';
import { getApiErrorMessage } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/common/combo';
import { useCustomers } from '@/features/customers/use-customers';
import { useAgents } from '@/features/agents/use-agents';
import { useActiveBankAccounts, useChequeOptions, usePaymentContext, usePaymentLedger, useSavePayment } from './use-account';
import { exportPendingInvoices } from './payment-pending-export';

const money = (v: number | null | undefined) => `₹ ${(v ?? 0).toLocaleString('en-IN')}`;
const n2 = (v: number) => v.toLocaleString('en-IN');
const prettyDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const TODAY = () => ymd(new Date());
/** Indian FY start (Apr 1) for the Receipt Ledger default range. */
function fyStart(): string {
  const t = new Date();
  return ymd(new Date(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1));
}

const DUE_STYLE: Record<string, { row: string; badge: string }> = {
  NORMAL: { row: 'bg-emerald-50/70', badge: 'bg-emerald-100 text-emerald-700 ring-emerald-200' },
  'PAST DUE': { row: 'bg-amber-50/70', badge: 'bg-amber-100 text-amber-700 ring-amber-200' },
  OVERDUE: { row: 'bg-rose-50/70', badge: 'bg-rose-100 text-rose-700 ring-rose-200' },
};

export function PaymentPage() {
  const { can } = usePermissions();
  const canCreate = can('payment:create');

  /* ── form state ─────────────────────────────────────────────────────────── */
  const [recDate, setRecDate] = useState(TODAY);
  const [party, setParty] = useState('');
  const [agent, setAgent] = useState('');
  const [payMode, setPayMode] = useState('');
  const [bankName, setBankName] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [cashLoc, setCashLoc] = useState('');
  const [cashBy, setCashBy] = useState('');
  const [adjMode, setAdjMode] = useState('AUTOMATIC');
  const [receiptStr, setReceiptStr] = useState('');
  const [remarks, setRemarks] = useState('');
  /** AGST REF: ticked invoice numbers, in tick order. */
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<SavePaymentResult | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  /* ── lookups ────────────────────────────────────────────────────────────── */
  const { data: customerData } = useCustomers({ page: 1, pageSize: 1000 });
  const { data: agentData } = useAgents({ page: 1, pageSize: 1000 });
  const { data: banks } = useActiveBankAccounts();
  const byParty = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customerData?.items ?? []) if (c.partyName) m.set(c.partyName, c.id);
    return m;
  }, [customerData]);
  const partyOptions = useMemo(() => [...byParty.keys()].sort((a, b) => a.localeCompare(b)), [byParty]);
  const agentOptions = useMemo(
    () => (agentData?.items ?? []).map((a) => a.name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [agentData],
  );
  const bankOptions = useMemo(() => (banks ?? []).map((b) => b.display), [banks]);

  const customerId = party ? byParty.get(party) : undefined;
  const isAgent = !party && !!agent;
  const ownerChosen = customerId != null || isAgent;
  const ownerLabel = party || agent;

  /* ── pending context ────────────────────────────────────────────────────── */
  const ctxQuery = { customerId: isAgent ? undefined : customerId, agentName: isAgent ? agent : undefined, recDate };
  const { data: ctx, error: ctxError, isLoading: ctxLoading } = usePaymentContext(ctxQuery, ownerChosen);
  useEffect(() => {
    // Legacy PAY BY / agent-parties restrictions come back as 400s — surface them.
    if (ctxError) toast.error(getApiErrorMessage(ctxError, 'Failed to load pending data'));
  }, [ctxError]);

  const bucket: 'BANK' | 'CASH' = payMode === 'CASH' ? 'CASH' : 'BANK';
  const invoices = ctx?.invoices ?? [];
  const bucketAmt = (r: PendingInvoiceRow) => (bucket === 'BANK' ? r.bankBal : r.cashBal);

  /* ── cheque picker (CHEQUE mode, party only) ────────────────────────────── */
  const { data: chequeOpts } = useChequeOptions(customerId, payMode === 'CHEQUE');
  const chequeByNo = useMemo(() => new Map((chequeOpts ?? []).map((c) => [c.chequeNo, c])), [chequeOpts]);
  const pickCheque = (no: string) => {
    setChequeNo(no);
    const c = chequeByNo.get(no);
    if (c) setReceiptStr(String(c.balance)); // legacy auto-fills the balance
  };
  const chequeComment = chequeByNo.get(chequeNo)?.comments ?? null;

  /* ── live allocation preview (mirrors the engine sizing) ────────────────── */
  const receipt = Number(receiptStr) || 0;
  const preview = useMemo(() => {
    const openingPend = (ctx?.openings ?? []).reduce((a, o) => a + (bucket === 'BANK' ? o.pendingBank : o.pendingCash), 0);
    const openingUse = Math.min(openingPend, Math.max(0, receipt));
    let avail = Math.max(0, receipt - openingUse);
    const adjByInv = new Map<string, number>();
    if (adjMode !== 'ADVANCE') {
      const order =
        adjMode === 'AGST REF'
          ? (selected.map((no) => invoices.find((i) => i.invNo === no)).filter(Boolean) as PendingInvoiceRow[])
          : invoices;
      for (const inv of order) {
        if (avail <= 0.004) break;
        const alloc = Math.min(bucketAmt(inv), avail);
        if (alloc <= 0.004) continue;
        adjByInv.set(inv.invNo, Math.round(alloc * 100) / 100);
        avail = Math.round((avail - alloc) * 100) / 100;
      }
    }
    const adjTotal = [...adjByInv.values()].reduce((a, v) => a + v, 0);
    return { openingPend, openingUse, adjByInv, adjTotal, advanceToSave: Math.max(0, Math.round((receipt - openingUse - adjTotal) * 100) / 100) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, receipt, adjMode, selected, bucket, invoices]);

  /* ── AGST REF ticking (with the legacy auto-trim) ───────────────────────── */
  useEffect(() => {
    if (adjMode !== 'AGST REF' || !selected.length) return;
    let rem = Math.max(0, receipt - preview.openingUse);
    const kept: string[] = [];
    for (const no of selected) {
      if (rem <= 0.004) break;
      const inv = invoices.find((i) => i.invNo === no);
      if (!inv) continue;
      kept.push(no);
      rem -= bucketAmt(inv);
    }
    if (kept.length !== selected.length) {
      setSelected(kept);
      toast.warning('Remaining balance is insufficient. Extra selected rows were removed.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt, adjMode, invoices.length]);

  const toggleSel = (invNo: string) => {
    setSelected((sel) => {
      if (sel.includes(invNo)) return sel.filter((s) => s !== invNo);
      // Legacy: refuse a new tick when nothing is left to allocate.
      const remaining = receipt - preview.openingUse - preview.adjTotal;
      if (receipt > 0 && remaining <= 0.004) {
        toast.warning('Remaining balance is 0. Please uncheck some rows or increase receipt amount.');
        return sel;
      }
      return [...sel, invNo];
    });
  };

  /* ── KPI cards (NORMAL / PAST DUE / OVERDUE) ────────────────────────────── */
  const kpis = useMemo(() => {
    const mk = () => ({ bank: 0, cash: 0, count: 0 });
    const out: Record<string, { bank: number; cash: number; count: number }> = { NORMAL: mk(), 'PAST DUE': mk(), OVERDUE: mk() };
    for (const i of invoices) {
      const k = out[i.dueType] ?? out.NORMAL;
      k.bank += i.bankBal;
      k.cash += i.cashBal;
      k.count += 1;
    }
    return out;
  }, [invoices]);

  /* ── actions ────────────────────────────────────────────────────────────── */
  const save = useSavePayment();

  const clearAll = () => {
    setParty('');
    setAgent('');
    setPayMode('');
    setBankName('');
    setChequeNo('');
    setCashLoc('');
    setCashBy('');
    setAdjMode('AUTOMATIC');
    setReceiptStr('');
    setRemarks('');
    setSelected([]);
    setRecDate(TODAY());
  };

  const submit = () => {
    // Legacy ValidateBeforeSave, same messages in the same order.
    if (!ownerChosen) return toast.error('Please select either Customer / Party Name or Agent Name.');
    if (!payMode) return toast.error('Please select Payment Mode (BANK / CHEQUE / CASH).');
    if (!(receipt > 0)) return toast.error('Receipt Amount must be greater than 0.');
    if ((payMode === 'BANK' || payMode === 'CHEQUE') && !bankName.trim()) return toast.error('Please select a Bank Name.');
    if (payMode === 'CHEQUE' && !chequeNo.trim()) return toast.error('Please select / enter Cheque No.');
    if (payMode === 'CASH' && !cashLoc.trim()) return toast.error('Please enter Cash Transfer Location.');
    if (payMode === 'CASH' && !cashBy.trim()) return toast.error('Please enter Cash Received By.');
    if (adjMode === 'AGST REF' && selected.length === 0) return toast.error('AGST REF mode requires selecting at least one invoice.');

    save.mutate(
      {
        takeAccOn: isAgent ? 'AGENT' : 'PARTY',
        customerId: isAgent ? null : customerId,
        agentName: isAgent ? agent : null,
        payMode,
        bankName: bankName || null,
        chequeNo: chequeNo || null,
        cashTransLocation: cashLoc || null,
        cashRecBy: cashBy || null,
        adjMode,
        selectedInvNos: adjMode === 'AGST REF' ? selected : undefined,
        receiptAmt: receipt,
        recDate,
        remarks: remarks || null,
      },
      {
        onSuccess: (res) => {
          setResult(res);
          clearAll();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );
  };

  // Ctrl+E → Receipt Ledger (legacy shortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        if (!ownerChosen) toast.error('Please select PARTY NAME or AGENT NAME first.');
        else setLedgerOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ownerChosen]);

  const exportPending = () => {
    if (!invoices.length) return toast.error('No invoices to export.');
    exportPendingInvoices(invoices, {
      owner: ownerLabel,
      ownerKind: isAgent ? 'Agent' : 'Party',
      payMode,
      asOf: prettyDate(new Date(recDate).toISOString()),
      bucket,
      showParty: isAgent,
      adjByInv: preview.adjByInv,
    });
  };

  const openingLabel = payMode ? (bucket === 'BANK' ? preview.openingPend : preview.openingPend) : preview.openingPend;
  const invoiceOutstanding = invoices.reduce((a, i) => a + bucketAmt(i), 0);
  const advanceAvail = (ctx?.totals && (bucket === 'BANK' ? ctx.totals.advanceBank : ctx.totals.advanceCash)) ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <HandCoins className="size-5" />
        </div>
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">Make Payment</h2>
          <p className="text-muted-foreground text-base">Receive money from a party or an agent — openings clear first, then invoices oldest-first, the rest parks on account.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => (ownerChosen ? setLedgerOpen(true) : toast.error('Please select PARTY NAME or AGENT NAME first.'))}
            title="Receipt ledger (Ctrl+E)"
          >
            <ScrollText /> Receipt Ledger
          </Button>
          <Button variant="outline" onClick={exportPending} disabled={!invoices.length} title="Download the pending invoices to Excel">
            <Download className="text-emerald-600" /> Pending Excel
          </Button>
        </div>
      </div>

      {/* Receipt form */}
      <div className="bg-card space-y-3 rounded-md border p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-sm">Receipt Date *</Label>
            <Input type="date" max={TODAY()} value={recDate} onChange={(e) => setRecDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Party Name</Label>
            <NativeSelect value={party} onChange={(v) => { setParty(v); if (v) setAgent(''); setSelected([]); }} options={['', ...partyOptions]} placeholder="Select party…" disabled={!!agent} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Agent Name</Label>
            <NativeSelect value={agent} onChange={(v) => { setAgent(v); if (v) setParty(''); setSelected([]); }} options={['', ...agentOptions]} placeholder="…or select agent" disabled={!!party} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Payment Mode *</Label>
            <NativeSelect value={payMode} onChange={(v) => { setPayMode(v); setChequeNo(''); setSelected([]); }} options={['', 'BANK', 'CHEQUE', 'CASH']} placeholder="BANK / CHEQUE / CASH" />
          </div>

          {(payMode === 'BANK' || payMode === 'CHEQUE') && (
            <div className="space-y-1">
              <Label className="text-sm">Bank Name *</Label>
              <NativeSelect value={bankName} onChange={setBankName} options={bankOptions} placeholder="Our receiving account…" />
            </div>
          )}
          {payMode === 'CHEQUE' && (
            <div className="space-y-1">
              <Label className="text-sm">Cheque No * <span className="text-muted-foreground">(cleared)</span></Label>
              <NativeSelect
                value={chequeNo}
                onChange={pickCheque}
                options={(chequeOpts ?? []).map((c) => c.chequeNo)}
                placeholder={isAgent ? 'Party mode only' : (chequeOpts?.length ? 'Select cheque…' : 'No cleared cheques')}
                disabled={isAgent}
              />
            </div>
          )}
          {payMode === 'CASH' && (
            <>
              <div className="space-y-1">
                <Label className="text-sm">Cash Transfer Location *</Label>
                <Input value={cashLoc} onChange={(e) => setCashLoc(e.target.value)} className="uppercase" placeholder="e.g. SHOP" />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Cash Received By *</Label>
                <Input value={cashBy} onChange={(e) => setCashBy(e.target.value)} className="uppercase" placeholder="Who collected" />
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label className="text-sm">Mode of Adj *</Label>
            <NativeSelect value={adjMode} onChange={(v) => { setAdjMode(v); setSelected([]); }} options={['AUTOMATIC', 'ADVANCE', 'AGST REF']} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Receipt Amount *</Label>
            <Input value={receiptStr} onChange={(e) => setReceiptStr(e.target.value)} inputMode="decimal" placeholder="0" className="text-right text-base font-semibold tabular-nums" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-sm">Remarks</Label>
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="uppercase" placeholder="Optional" />
          </div>
        </div>

        {chequeComment && (
          <p className="rounded-md bg-slate-600 px-3 py-1.5 text-sm font-semibold text-white">Cheque note: {chequeComment}</p>
        )}
        {bankOptions.length === 0 && (payMode === 'BANK' || payMode === 'CHEQUE') && (
          <p className="flex items-center gap-1.5 text-sm text-amber-600">
            <Landmark className="size-4" /> No active bank accounts — add one under Account → Bank Accounts.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {canCreate && (
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} SUBMIT
            </Button>
          )}
          <Button variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-50" onClick={clearAll}>
            <RotateCcw /> CLEAR
          </Button>
          <div className="text-muted-foreground ml-auto flex flex-wrap gap-x-5 gap-y-1 text-base">
            <span>Opening: <b className="text-foreground tabular-nums">{money(openingLabel)}</b></span>
            <span>Invoices ({bucket.toLowerCase()}): <b className="text-foreground tabular-nums">{money(invoiceOutstanding)}</b></span>
            <span>Advance available: <b className="text-foreground tabular-nums">{money(advanceAvail)}</b></span>
            <span>To allocate: <b className="tabular-nums text-blue-700">{money(preview.openingUse + preview.adjTotal)}</b></span>
            <span>Advance to save: <b className={cn('tabular-nums', preview.advanceToSave > 0 ? 'text-amber-700' : 'text-foreground')}>{money(preview.advanceToSave)}</b></span>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      {ownerChosen && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {(['NORMAL', 'PAST DUE', 'OVERDUE'] as const).map((k) => {
            const v = kpis[k];
            const active = !!payMode && (bucket === 'BANK' ? v.bank : v.cash) > 0;
            const tone = k === 'NORMAL' ? 'emerald' : k === 'PAST DUE' ? 'amber' : 'rose';
            return (
              <div key={k} className={cn('rounded-lg border p-3 shadow-sm transition-opacity', `border-${tone}-200 bg-${tone}-50/60`, !active && 'opacity-70')}>
                <p className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">{k} DUE'S ({v.count})</p>
                <div className="mt-1 flex gap-5 text-base tabular-nums">
                  <span className={cn(payMode && bucket === 'BANK' && 'font-bold')}>Bank: {money(v.bank)}</span>
                  <span className={cn(payMode && bucket === 'CASH' && 'font-bold')}>Cash: {money(v.cash)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending invoices grid */}
      <div className="bg-card overflow-hidden rounded-md border shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="bg-gradient-to-b from-blue-800 to-indigo-800 text-white [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-sm [&_th]:font-bold [&_th]:tracking-wider [&_th]:uppercase [&_th]:whitespace-nowrap">
                {adjMode === 'AGST REF' && <th className="w-10">Sel</th>}
                <th>Inv Date</th>
                <th>Inv No</th>
                {isAgent && <th>Party Name</th>}
                <th>Transaction</th>
                <th>Due Date</th>
                <th>Status</th>
                <th className="!text-right">{payMode ? `${bucket} Amt` : 'Amt'}</th>
                <th className="!text-right">Adj Amt</th>
                <th className="!text-right">Bal Amt</th>
                <th>Due Days</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_td]:whitespace-nowrap">
              {!ownerChosen ? (
                <tr><td colSpan={11} className="text-muted-foreground h-24 text-center">Select a Party or an Agent to load pending invoices.</td></tr>
              ) : ctxLoading && !ctx ? (
                <tr><td colSpan={11} className="h-24 text-center"><Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" /></td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={11} className="text-muted-foreground h-24 text-center">No pending invoices — everything is settled. 🎉</td></tr>
              ) : (
                invoices.map((r) => {
                  const amt = bucketAmt(r);
                  const adj = preview.adjByInv.get(r.invNo) ?? 0;
                  const bal = Math.max(0, Math.round((amt - adj) * 100) / 100);
                  const ticked = selected.includes(r.invNo);
                  const style = DUE_STYLE[r.dueType] ?? DUE_STYLE.NORMAL;
                  return (
                    <tr key={r.invNo} className={cn(ticked ? 'bg-slate-200/70' : style.row)}>
                      {adjMode === 'AGST REF' && (
                        <td>
                          <input type="checkbox" className="size-4" checked={ticked} onChange={() => toggleSel(r.invNo)} />
                        </td>
                      )}
                      <td>{prettyDate(r.invDate)}</td>
                      <td className="font-mono font-semibold">{r.invNo}</td>
                      {isAgent && <td className="font-medium">{r.customerName}</td>}
                      <td>{r.transaction}</td>
                      <td>{prettyDate(r.dueDate)}</td>
                      <td>
                        <span className={cn('rounded px-1.5 py-0.5 text-sm font-semibold ring-1 ring-inset', style.badge)}>{r.dueType}</span>
                      </td>
                      <td className="text-right font-semibold tabular-nums">{n2(amt)}</td>
                      <td className={cn('text-right tabular-nums', adj > 0 && 'font-bold text-blue-700')}>{adj ? n2(adj) : '—'}</td>
                      <td className="text-right tabular-nums">{n2(bal)}</td>
                      <td className={cn('text-sm font-semibold', r.dueType === 'OVERDUE' ? 'text-rose-600' : 'text-muted-foreground')}>{r.dueDays}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Save result */}
      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="size-6 text-emerald-600" /> Saved successfully
            </DialogTitle>
            <DialogDescription className="text-base">Voucher No = <b className="font-mono">{result?.voucherNo}</b></DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 text-base">
            <p className="flex justify-between"><span>Opening cleared</span><b className="tabular-nums">{money(result?.openingCleared)}</b></p>
            <p className="flex justify-between"><span>Invoices cleared</span><b className="tabular-nums">{money(result?.invoicesCleared)}</b></p>
            <p className="flex justify-between"><span>Advance saved</span><b className="tabular-nums">{money(result?.advanceParked)}</b></p>
            {result?.receiptRefId && <p className="text-muted-foreground text-sm">Receipt REF ID: <span className="font-mono">{result.receiptRefId}</span></p>}
            {result?.advanceRefId && <p className="text-muted-foreground text-sm">Advance REF ID: <span className="font-mono">{result.advanceRefId}</span></p>}
          </div>
          {!!result?.allocations?.length && (
            <div className="max-h-56 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-muted-foreground [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:uppercase">
                    <th>What</th><th>Invoice</th><th>Funded by</th><th className="!text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:border-t [&_td]:px-2.5 [&_td]:py-1.5">
                  {result.allocations.map((a, i) => (
                    <tr key={i}>
                      <td>{a.kind === 'OPENING' ? 'Opening' : a.kind === 'INVOICE' ? 'Invoice' : 'Advance'}</td>
                      <td className="font-mono text-xs">{a.invNo ?? a.customerName}</td>
                      <td className="font-mono text-xs">{a.fundedBy}</td>
                      <td className="text-right font-semibold tabular-nums">{n2(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ledgerOpen && <LedgerModal ownerKind={isAgent ? 'Agent' : 'Party'} owner={ownerLabel} customerId={isAgent ? undefined : customerId} agentName={isAgent ? agent : undefined} onClose={() => setLedgerOpen(false)} />}
    </div>
  );
}

/* ── Receipt Ledger browser (legacy Button1 / Ctrl+E) ───────────────────────── */

function LedgerModal({ ownerKind, owner, customerId, agentName, onClose }: { ownerKind: string; owner: string; customerId?: number; agentName?: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePaymentLedger({ customerId, agentName, dateFrom: fyStart(), dateTo: TODAY(), page, pageSize: 25 });
  const rows = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] w-[min(900px,96vw)] max-w-[96vw] overflow-y-auto sm:!max-w-[900px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <BookOpenCheck className="text-primary size-5" /> Receipt Ledger — {ownerKind}: {owner}
          </DialogTitle>
          <DialogDescription className="text-base">Vouchers this financial year (Apr–Mar).</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-b from-blue-800 to-indigo-800 text-white [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:whitespace-nowrap">
                <th>Voucher</th><th>Date</th><th>Customer</th><th>Mode</th><th>Particulars</th><th className="!text-right">Bank Cr</th><th className="!text-right">Cash Cr</th><th>Remarks</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-1.5 [&_td]:whitespace-nowrap">
              {isLoading ? (
                <tr><td colSpan={8} className="h-20 text-center"><Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-muted-foreground h-20 text-center">No receipts recorded this financial year.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="even:bg-muted/25">
                    <td className="font-mono font-semibold">{r.voucherNo}</td>
                    <td>{prettyDate(r.transDate)}</td>
                    <td>{r.customerName}</td>
                    <td>{r.transMode}</td>
                    <td className="max-w-56 truncate" title={r.particulars ?? ''}>{r.particulars ?? '—'}</td>
                    <td className="text-right font-semibold tabular-nums">{r.bankCredit ? n2(r.bankCredit) : '—'}</td>
                    <td className="text-right font-semibold tabular-nums">{r.cashCredit ? n2(r.cashCredit) : '—'}</td>
                    <td className="text-muted-foreground max-w-40 truncate" title={r.transRemarks ?? ''}>{r.transRemarks ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <DialogFooter className="sm:justify-between">
          <p className="text-muted-foreground text-sm">{data?.total ?? 0} voucher(s) · page {data?.page ?? page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft /> Prev</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next <ChevronRight /></Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PaymentPage;
