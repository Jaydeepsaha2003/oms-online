import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  ScrollText,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerEntryDto, PendingInvoiceRow, SavePaymentResult } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { downloadFilePost, getApiErrorMessage } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NativeSelect } from '@/components/common/combo';
import { useConfirm } from '@/components/common/confirm';
import { RowCheckbox } from '@/components/common/row-checkbox';
import { useCustomers } from '@/features/customers/use-customers';
import { useAgents } from '@/features/agents/use-agents';
import { useActiveBankAccounts, useChequeOptions, useDeletePayment, useDeletePayments, useEditPayment, usePaymentContext, usePaymentLedger, useSavePayment } from './use-account';

const inr = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const money = (v: number | null | undefined) => `₹ ${inr(v)}`;
/** A zero figure reads as "-" in the summary strip — accounting-statement style,
 *  the same convention the Party Ledger / Daybook summary rows use. */
const moneyOrDash = (v: number) => (v ? inr(v) : '-');
const prettyDate = (iso: string | null) => formatDate(iso);
/** Voucher type as it reads on screen: a plain sale is just "SALES" (the stored
 *  value is "SALES INVOICE", which is needlessly long in a dense grid). Display
 *  only — the underlying value still drives matching, saving and the export. */
const txnLabel = (t: string) => (t.trim().toUpperCase() === 'SALES INVOICE' ? 'SALES' : t);

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const TODAY = () => ymd(new Date());
/**
 * Money as a person actually types it.
 *
 * The amount box is a free-text field and every figure on this screen is
 * PRINTED with Indian grouping ("20,51,094"), so typing it back with commas is
 * the natural thing to do — but `Number("1,00,000")` is NaN, which fell through
 * to 0. The whole voucher then behaved as though nothing had been entered: no
 * Clear Amt on any row, a ₹0 summary, and on save the contradictory "Receipt
 * Amount must be greater than 0" while the box plainly showed a figure. That is
 * the "sometimes works, sometimes not" — plain digits worked, grouped ones
 * silently did nothing.
 *
 * Anything that isn't a digit or a decimal point is dropped, so commas, spaces,
 * "₹" and a trailing "/-" all read correctly. A minus is dropped too: a negative
 * receipt has no meaning here.
 */
export const parseAmount = (s: string): number => {
  const cleaned = (s ?? '').replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  // Keep only the FIRST decimal point ("1.2.3" is a typo, not 1.23).
  const single = dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
  const n = Number(single);
  return Number.isFinite(n) ? n : 0;
};

/** Indian FY start (Apr 1) for the View Receipts default range. */
function fyStart(): string {
  const t = new Date();
  return ymd(new Date(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1));
}

/* ── Tally palette — the amber chrome + navy column strip used across the
   account screens (Party Ledger, Daybook), so this voucher reads as part of
   the same accounting family. ─────────────────────────────────────────────── */

/** Compact, amber-bordered controls — the house filter/input language. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-400 dark:border-amber-400/60 text-[12.5px] focus-visible:border-amber-600 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';
/** Small caps field caption sitting above each control. */
const FIELD_LABEL = 'text-[10px] font-bold tracking-widest text-amber-900/70 uppercase dark:text-amber-200/60';
/** Sticky navy→indigo column strip — identical to every other grid in the app. */
const TH =
  'sticky top-0 z-10 bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-left text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap dark:from-blue-900 dark:to-indigo-900';
const TH_LINE = 'border-r border-white/15';
const TD = 'border-r border-r-amber-200/80 px-2 py-[3px] align-middle dark:border-r-amber-400/15 last:border-r-0';
const NUM = 'text-right tabular-nums';
/** The frame around each worksheet panel. */
const PANEL = 'border-amber-400 dark:border-amber-400/50';
/** The dark document caption bar that tops each panel. */
const DOC_BAR = 'flex shrink-0 items-center justify-between gap-3 bg-slate-800 px-2.5 py-1 dark:bg-slate-900';
const DOC_TITLE = 'truncate text-[12px] font-extrabold tracking-wide text-amber-300 uppercase';

/** Per-status row tint + chip, matching the legacy traffic-light grid. */
const DUE_STYLE: Record<string, { row: string; chip: string; text: string }> = {
  NORMAL: {
    row: 'bg-emerald-50/60 dark:bg-emerald-400/[0.06]',
    chip: 'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-300 dark:ring-emerald-400/25',
    text: 'text-emerald-700 dark:text-emerald-400',
  },
  'PAST DUE': {
    row: 'bg-amber-50/70 dark:bg-amber-400/[0.07]',
    chip: 'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/25',
    text: 'text-amber-700 dark:text-amber-400',
  },
  OVERDUE: {
    row: 'bg-rose-50/70 dark:bg-rose-400/[0.07]',
    chip: 'bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-400/15 dark:text-rose-300 dark:ring-rose-400/25',
    text: 'text-rose-600 dark:text-rose-400',
  },
};

export function PaymentPage() {
  const { can } = usePermissions();
  const canCreate = can('payment:create');
  // Arriving from Party Advances (or anywhere else) can hand over a party or
  // agent name to preselect, so the user lands straight on that pending context.
  const { state } = useLocation() as { state?: { party?: string; agent?: string } | null };
  const confirm = useConfirm();

  /* ── form state ─────────────────────────────────────────────────────────── */
  const [recDate, setRecDate] = useState(TODAY);
  const [party, setParty] = useState(state?.party ?? '');
  const [agent, setAgent] = useState(state?.agent ?? '');
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
  // payMode is part of the query: routing is per money bucket, so which parties
  // an agent can be paid for — and therefore which invoices are pending — changes
  // when the mode does.
  const ctxQuery = { customerId: isAgent ? undefined : customerId, agentName: isAgent ? agent : undefined, recDate, payMode: payMode || undefined };
  const { data: ctx, error: ctxError, isLoading: ctxLoading } = usePaymentContext(ctxQuery, ownerChosen);
  useEffect(() => {
    // Legacy PAY BY / agent-parties restrictions come back as 400s — surface them.
    if (ctxError) toast.error(getApiErrorMessage(ctxError, 'Failed to load pending data'));
  }, [ctxError]);

  // Switching mode reloads a different set of parties, so invoices ticked under
  // the old one may no longer be on screen — clear them rather than carry a
  // selection the user can no longer see.
  useEffect(() => setSelected([]), [payMode]);

  const bucket: 'BANK' | 'CASH' = payMode === 'CASH' ? 'CASH' : 'BANK';
  const allInvoices = ctx?.invoices ?? [];
  const bucketAmt = (r: PendingInvoiceRow) => (bucket === 'BANK' ? r.bankBal : r.cashBal);
  /**
   * What the grid PRINTS for a row, as opposed to what an allocation computes on
   * ({@link bucketAmt}). Before a mode is picked there is no leg to report on,
   * so each row shows its WHOLE outstanding (bank + cash) — `bucket` merely
   * defaults to BANK then, and printing that bucket made every invoice whose
   * bank side was settled but whose cash side wasn't render as an absurd "0"
   * row (₹5L of real cash dues showing as a page of zeros). Once a mode is
   * picked the two are the same thing, because the list is filtered to rows
   * with money in that bucket.
   */
  const displayAmt = (r: PendingInvoiceRow) => (payMode ? bucketAmt(r) : Math.round((r.bankBal + r.cashBal) * 100) / 100);
  /** The grid only lists invoices that carry money in the CHOSEN bucket — the
   *  legacy form does the same, so a cash-only bill never shows as a "0" row
   *  while you're recording a bank receipt. Before a mode is picked, show all. */
  const invoices = useMemo(
    () => (payMode ? allInvoices.filter((r) => bucketAmt(r) > 0.004) : allInvoices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allInvoices, payMode, bucket],
  );

  /* ── cheque picker (CHEQUE mode, party only) ────────────────────────────── */
  const { data: chequeOpts } = useChequeOptions(customerId, payMode === 'CHEQUE');
  const chequeByNo = useMemo(() => new Map((chequeOpts ?? []).map((c) => [c.chequeNo, c])), [chequeOpts]);
  const pickCheque = (no: string) => {
    setChequeNo(no);
    const c = chequeByNo.get(no);
    if (c) setReceiptStr(String(c.balance)); // legacy auto-fills the balance
  };
  const chequeComment = chequeByNo.get(chequeNo)?.comments ?? null;

  /**
   * Advance already sitting on account for this party.
   *
   * In PARTY mode the engine funds invoice clearing from this FIRST, then from
   * today's receipt. That doesn't let the receipt clear any more invoices than it
   * could alone — allocations are still sized by the receipt — but every rupee the
   * old advance funds frees an equal rupee of receipt cash, which re-parks as a
   * fresh advance. So an existing advance inflates what gets parked. AGENT mode
   * ignores advances entirely and funds purely from the receipt.
   */
  const advanceAvail = (ctx?.totals && (bucket === 'BANK' ? ctx.totals.advanceBank : ctx.totals.advanceCash)) ?? 0;

  /* ── live allocation preview (mirrors the engine exactly) ───────────────── */
  const receipt = parseAmount(receiptStr);
  const preview = useMemo(() => {
    const openingPend = (ctx?.openings ?? []).reduce((a, o) => a + (bucket === 'BANK' ? o.pendingBank : o.pendingCash), 0);
    const openingUse = Math.min(openingPend, Math.max(0, receipt));
    /* What this voucher can clear: today's receipt after any opening balance,
       PLUS the party's existing advance — the engine sizes it the same way, so
       an advance on account comes off the bill instead of rolling forward. */
    const canClear = Math.max(0, receipt - openingUse) + (isAgent ? 0 : advanceAvail);
    let avail = canClear;
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
    /** Old advance spent on the invoices above — this part costs no cash. */
    const advanceUsed = isAgent ? 0 : Math.round(Math.min(advanceAvail, adjTotal) * 100) / 100;
    /** Only the rest of the allocation is paid for out of today's receipt. */
    const cashOnInvoices = Math.round((adjTotal - advanceUsed) * 100) / 100;
    return {
      openingPend,
      openingUse,
      adjByInv,
      adjTotal,
      advanceUsed,
      // Whatever cash the invoices did not need parks on account.
      advanceToSave: Math.max(0, Math.round((receipt - openingUse - cashOnInvoices) * 100) / 100),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, receipt, adjMode, selected, bucket, invoices, advanceAvail, isAgent]);

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

  /* ── the six ledger-summary figures (legacy header block) ───────────────── */
  const invoiceOutstanding = invoices.reduce((a, i) => a + displayAmt(i), 0);
  /** Before a pay mode is picked there's no "leg" to report on, so the opening
   *  shows both sides added together — same as the legacy form does. */
  const openingDisplay = payMode ? preview.openingPend : ((ctx?.totals?.openingBank ?? 0) + (ctx?.totals?.openingCash ?? 0));
  const currentOutstanding = openingDisplay + invoiceOutstanding;
  const allocated = preview.openingUse + preview.adjTotal;
  const outstandingAfterAdj = Math.max(0, Math.round((currentOutstanding - allocated) * 100) / 100);
  const remainingBalance = Math.max(0, Math.round((receipt - allocated) * 100) / 100);
  /** Nothing left to clear → the only sensible adjustment is to park the money,
   *  so the legacy form locks the mode to ADVANCE. Mirror that.
   *
   *  BOTH WAYS, though. This used to be one-way: a party with nothing pending
   *  flipped the mode to ADVANCE and it stayed there, so the NEXT party — with
   *  bills open and an advance on account — had the whole receipt parked
   *  on account too. ADVANCE mode skips invoice allocation entirely, and with
   *  it the step that spends old advances first, so the money sat there while
   *  the invoice stayed past due. Undo it when there is something to clear
   *  again. */
  const noPending = ownerChosen && !ctxLoading && invoices.length === 0;
  /** True only while ADVANCE was chosen by the FORM. A mode the user picked
   *  themselves is never overridden — see the mode select's onChange. */
  const advanceForced = useRef(false);
  useEffect(() => {
    if (noPending) {
      if (adjMode !== 'ADVANCE') {
        advanceForced.current = true;
        setAdjMode('ADVANCE');
      }
    } else if (advanceForced.current) {
      advanceForced.current = false;
      setAdjMode('AUTOMATIC');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noPending]);

  /* ── due buckets — bank and cash are counted SEPARATELY (a bill can be open
       on one leg and settled on the other), matching the legacy overview. ─── */
  const buckets = useMemo(() => {
    const mk = () => ({ bank: 0, cash: 0, bankCount: 0, cashCount: 0 });
    const out: Record<string, ReturnType<typeof mk>> = { NORMAL: mk(), 'PAST DUE': mk(), OVERDUE: mk() };
    for (const i of allInvoices) {
      const k = out[i.dueType] ?? out.NORMAL;
      if (i.bankBal > 0.004) {
        k.bank += i.bankBal;
        k.bankCount += 1;
      }
      if (i.cashBal > 0.004) {
        k.cash += i.cashBal;
        k.cashCount += 1;
      }
    }
    return out;
  }, [allInvoices]);

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
    advanceForced.current = false;
    setAdjMode('AUTOMATIC');
    setReceiptStr('');
    setRemarks('');
    setSelected([]);
    setRecDate(TODAY());
  };

  // True while submit() is waiting on a confirmation dialog. Without it the
  // SUBMIT button stays live during those awaits (`save.isPending` is still
  // false), so a double tap could open two dialogs and book the receipt twice —
  // the very duplicate the first check below exists to prevent.
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting || save.isPending) return;
    // Legacy ValidateBeforeSave, same messages in the same order.
    if (!ownerChosen) return toast.error('Please select either Customer / Party Name or Agent Name.');
    if (!payMode) return toast.error('Please select Payment Mode (BANK / CHEQUE / CASH).');
    if (!(receipt > 0)) return toast.error('Receipt Amount must be greater than 0.');
    if ((payMode === 'BANK' || payMode === 'CHEQUE') && !bankName.trim()) return toast.error('Please select a Bank Name.');
    if (payMode === 'CHEQUE' && !chequeNo.trim()) return toast.error('Please select / enter Cheque No.');
    if (payMode === 'CASH' && !cashLoc.trim()) return toast.error('Please enter Cash Transfer Location.');
    if (payMode === 'CASH' && !cashBy.trim()) return toast.error('Please enter Cash Received By.');
    if (adjMode === 'AGST REF' && selected.length === 0) return toast.error('AGST REF mode requires selecting at least one invoice.');

    setSubmitting(true);
    try {
      // ── 1. Same amount, same party, same day → probably a double entry ─────
      // Caught before saving because a duplicate receipt is genuinely painful to
      // unwind: it over-settles invoices and the surplus becomes a silent advance.
      const dup = (ctx?.sameDayReceipts ?? []).filter((r) => Math.abs(r.amount - receipt) < 0.01);
      if (dup.length) {
        const ok = await confirm({
          title: 'Possibly already received',
          description: `${inr(receipt)} was already received from ${ownerLabel} on ${formatDate(recDate)} — ${dup.map((d) => d.voucherNo).join(', ')}. Save this as a SECOND receipt for the same amount?`,
          confirmText: 'Yes, this is a separate payment',
          cancelText: 'No, let me check',
          destructive: true,
        });
        if (!ok) return;
      }

      // ── 2. Amount exactly matches one pending invoice → offer AGST REF ─────
      // AUTOMATIC would spread it oldest-first and could leave that invoice
      // open, which is almost never what paying an exact invoice amount meant.
      let adjModeToSave = adjMode;
      let selectedToSave = adjMode === 'AGST REF' ? selected : undefined;
      if (adjMode === 'AUTOMATIC') {
        const exact = invoices.filter((i) => Math.abs(bucketAmt(i) - receipt) < 0.01);
        if (exact.length === 1) {
          const inv = exact[0];
          const useAgst = await confirm({
            title: 'Matches one invoice exactly',
            description: `${inr(receipt)} is exactly the pending amount on ${inv.invNo}. Settle that invoice directly (AGST REF), or carry on adjusting oldest-first (AUTOMATIC)?`,
            confirmText: `Yes, use AGST REF for ${inv.invNo}`,
            cancelText: 'No, keep AUTOMATIC',
          });
          if (useAgst) {
            // Passed straight into the payload — setState wouldn't have applied
            // by the time mutate() reads it.
            adjModeToSave = 'AGST REF';
            selectedToSave = [inv.invNo];
            advanceForced.current = false;
            setAdjMode('AGST REF');
            setSelected([inv.invNo]);
          }
        }
      }

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
          adjMode: adjModeToSave,
          selectedInvNos: selectedToSave,
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
    } finally {
      // mutate() is callback-based, so this runs as soon as it's been fired —
      // from here on `save.isPending` is what keeps the button disabled.
      setSubmitting(false);
    }
  };

  useSaveShortcut(submit);

  // Ctrl+E → View Receipts (legacy shortcut).
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

  /**
   * Built on the SERVER, like the challan reports.
   *
   * The browser copy used SheetJS, which cannot write a font, a fill or a
   * border in its free build, so the file was a bare grid. The rows go UP
   * already computed — the Adj Amt column is the allocation being composed on
   * screen and has not been saved, so no query could reproduce it — and the
   * formatted workbook comes back.
   */
  const exportPending = async () => {
    if (!invoices.length) return toast.error('No invoices to export.');
    try {
      await downloadFilePost(
        '/payments/pending-report.xlsx',
        {
          owner: ownerLabel,
          ownerKind: isAgent ? 'Agent' : 'Party',
          payMode,
          asOf: prettyDate(new Date(recDate).toISOString()),
          bucket,
          showParty: isAgent,
          rows: invoices.map((r) => {
            const amt = bucket === 'BANK' ? r.bankBal : r.cashBal;
            const adj = preview.adjByInv.get(r.invNo) ?? 0;
            return {
              invDate: r.invDate,
              invNo: r.invNo,
              customerName: r.customerName,
              transaction: r.transaction,
              dueDate: r.dueDate,
              dueType: r.dueType,
              amt,
              adj,
              bal: Math.max(0, amt - adj),
              dueDays: r.dueDays,
            };
          }),
        },
        'Pending_Invoices.xlsx',
      );
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not build the export'));
    }
  };

  const needsBank = payMode === 'BANK' || payMode === 'CHEQUE';
  const gridCols = 9 + (adjMode === 'AGST REF' ? 1 : 0) + (isAgent ? 1 : 0);

  return (
    // Fills the viewport on desktop: the voucher panel stays put while only the
    // invoice grid scrolls. Below `lg` it falls back to a normal scrolling page,
    // where a fixed split would be unusable.
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2.5 font-sans sm:gap-2.5 sm:p-3 lg:overflow-hidden">
      {/* ── Split: voucher entry (left) · party ledger (right) ────────────── */}
      <div className="grid gap-2 sm:gap-2.5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(19rem,21rem)_1fr]">
        {/* ── Voucher entry ──────────────────────────────────────────────── */}
        <section className={cn('bg-card flex flex-col overflow-hidden rounded-[4px] border shadow-sm lg:min-h-0', PANEL)}>
          <div className={DOC_BAR}>
            <span className={DOC_TITLE}>Entry</span>
            <span className="shrink-0 text-[11px] font-bold tracking-wide text-white tabular-nums">{prettyDate(new Date(recDate).toISOString())}</span>
          </div>

          {/* Scrolls inside the panel only on the fixed-viewport desktop split;
              on smaller screens the whole page scrolls instead, so the fields
              never sit in a cramped nested scroller. */}
          <div className="space-y-2.5 p-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <div className="space-y-1">
              <Label htmlFor="rec-date" className={FIELD_LABEL}>Receipt Date *</Label>
              <DatePicker id="rec-date" value={recDate} onChange={(v) => v && setRecDate(v)} clearable={false} className={cn(CONTROL, 'w-full')} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="party" className={FIELD_LABEL}>Party Name</Label>
              <NativeSelect
                id="party"
                value={party}
                onChange={(v) => { setParty(v); if (v) setAgent(''); setSelected([]); }}
                options={['', ...partyOptions]}
                placeholder="Select party…"
                disabled={!!agent}
                className={cn(CONTROL, 'font-medium', party && CONTROL_ON)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="agent" className={FIELD_LABEL}>Agent Name</Label>
              <NativeSelect
                id="agent"
                value={agent}
                onChange={(v) => { setAgent(v); if (v) setParty(''); setSelected([]); }}
                options={['', ...agentOptions]}
                placeholder="…or select agent"
                disabled={!!party}
                className={cn(CONTROL, 'font-medium', agent && CONTROL_ON)}
              />
            </div>

            {/* Pay mode as a segmented control — three fixed choices read faster
                as buttons than as a dropdown, and it's one tap instead of two. */}
            <div className="space-y-1">
              <span className={FIELD_LABEL}>Payment Mode *</span>
              <div role="group" aria-label="Payment mode" className="grid grid-cols-3 gap-0.5 rounded-[4px] border border-amber-400 bg-amber-50/40 p-0.5 dark:border-amber-400/60 dark:bg-transparent">
                {(['BANK', 'CHEQUE', 'CASH'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={payMode === m}
                    onClick={() => { setPayMode(payMode === m ? '' : m); setChequeNo(''); setSelected([]); }}
                    className={cn(
                      // 44px tall on touch screens (comfortable tap target), tighter on desktop.
                      'min-h-11 cursor-pointer rounded-[3px] py-1.5 text-[11.5px] font-bold tracking-wide uppercase transition-colors duration-150 lg:min-h-8',
                      payMode === m
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {needsBank && (
              <div className="space-y-1">
                <Label htmlFor="bank" className={FIELD_LABEL}>Bank Name *</Label>
                <NativeSelect
                  id="bank"
                  value={bankName}
                  onChange={setBankName}
                  options={bankOptions}
                  placeholder="Our receiving account…"
                  className={cn(CONTROL, 'font-medium', bankName && CONTROL_ON)}
                />
                {bankOptions.length === 0 && (
                  <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    No active bank accounts — add one under Account → Bank Accounts.
                  </p>
                )}
              </div>
            )}

            {payMode === 'CHEQUE' && (
              <div className="space-y-1">
                <Label htmlFor="cheque" className={FIELD_LABEL}>Cheque No * (cleared)</Label>
                <NativeSelect
                  id="cheque"
                  value={chequeNo}
                  onChange={pickCheque}
                  options={(chequeOpts ?? []).map((c) => c.chequeNo)}
                  placeholder={isAgent ? 'Party mode only' : chequeOpts?.length ? 'Select cheque…' : 'No cleared cheques'}
                  disabled={isAgent}
                  className={cn(CONTROL, 'font-medium', chequeNo && CONTROL_ON)}
                />
                {chequeComment && (
                  <p className="rounded-[4px] bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white dark:bg-slate-800">{chequeComment}</p>
                )}
              </div>
            )}

            {payMode === 'CASH' && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="cash-loc" className={FIELD_LABEL}>Cash Transfer To *</Label>
                  <Input id="cash-loc" value={cashLoc} onChange={(e) => setCashLoc(e.target.value)} placeholder="e.g. SHOP" className={cn(CONTROL, 'uppercase')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cash-by" className={FIELD_LABEL}>Cash Received By *</Label>
                  <Input id="cash-by" value={cashBy} onChange={(e) => setCashBy(e.target.value)} placeholder="Who collected" className={cn(CONTROL, 'uppercase')} />
                </div>
              </>
            )}

            {/* The amount is the heart of the voucher — given its own emphasis
                so it never gets lost among the pickers above it. */}
            <div className="space-y-1 rounded-[4px] border-2 border-amber-500 bg-amber-50/70 p-2 dark:border-amber-400/60 dark:bg-amber-400/10">
              <Label htmlFor="rec-amt" className={FIELD_LABEL}>Receipt Amount *</Label>
              <Input
                id="rec-amt"
                value={receiptStr}
                onChange={(e) => setReceiptStr(e.target.value)}
                // Rewrite what was typed into the figure the voucher will use,
                // so "1,00,000" visibly becomes 100000 rather than leaving the
                // user to wonder which of the two the app took.
                onBlur={() => setReceiptStr((v) => (v.trim() === '' ? '' : String(parseAmount(v))))}
                inputMode="decimal"
                placeholder="0"
                className="bg-background h-10 rounded-[4px] text-right text-[17px] font-bold tabular-nums"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="adj-mode" className={FIELD_LABEL}>Mode of Adjustment *</Label>
                {advanceAvail > 0 && (
                  <span className="text-[10.5px] font-bold tabular-nums text-amber-700 dark:text-amber-400" title="Advance already on account — spent before this receipt">
                    Adv {inr(advanceAvail)}
                  </span>
                )}
              </div>
              <NativeSelect
                id="adj-mode"
                value={adjMode}
                onChange={(v) => { advanceForced.current = false; setAdjMode(v); setSelected([]); }}
                options={noPending ? ['ADVANCE'] : ['AUTOMATIC', 'ADVANCE', 'AGST REF']}
                disabled={noPending}
                className={cn(CONTROL, 'font-medium', CONTROL_ON)}
              />
              <p className="text-muted-foreground text-[11px] leading-snug">
                {noPending
                  ? 'Nothing pending — the receipt can only be parked on account.'
                  : adjMode === 'AUTOMATIC'
                    ? 'Clears openings, then invoices oldest-first.'
                    : adjMode === 'ADVANCE'
                      ? 'Parks the whole amount on account — no invoice is touched.'
                      : `Only the ticked invoices are cleared${selected.length ? ` (${selected.length} ticked).` : ' — tick rows in the grid.'}`}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="remarks" className={FIELD_LABEL}>Remarks</Label>
              <Input id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" className={cn(CONTROL, 'uppercase')} />
            </div>
          </div>

          {/* Live allocation read-out + the commit actions, pinned to the foot of
              the panel so they're reachable without scrolling the fields. */}
          <div className="shrink-0 border-t border-amber-300 bg-amber-50/60 p-2.5 dark:border-amber-400/30 dark:bg-amber-400/[0.07]">
            <div className="space-y-0.5">
              <AllocLine label="Opening cleared" value={preview.openingUse} />
              <AllocLine label="Invoices cleared" value={preview.adjTotal} />
              {preview.advanceUsed > 0 && <AllocLine label="…funded by old advance" value={preview.advanceUsed} />}
              <AllocLine label="To advance ledger" value={preview.advanceToSave} tone={preview.advanceToSave > 0 ? 'amber' : undefined} />
              <div className="mt-1 flex items-center justify-between border-t border-amber-600/30 pt-1 dark:border-amber-400/30">
                <span className="text-[11px] font-extrabold tracking-wide text-amber-950 uppercase dark:text-amber-100">Receipt</span>
                <span className="text-[15px] font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{inr(receipt)}</span>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              {canCreate && (
                <Button
                  onClick={submit}
                  disabled={save.isPending || submitting}
                  title="Save receipt (Ctrl+S)"
                  className="h-11 flex-[2] bg-emerald-600 font-bold text-white hover:bg-emerald-700 lg:h-10"
                >
                  {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} SUBMIT
                </Button>
              )}
              <Button variant="outline" onClick={clearAll} className="h-11 flex-1 border-rose-200 font-semibold text-rose-600 hover:bg-rose-50 lg:h-10 dark:border-rose-400/40 dark:text-rose-400 dark:hover:bg-rose-400/10">
                <RotateCcw /> CLEAR
              </Button>
            </div>
          </div>
        </section>

        {/* ── Party ledger: summary + allocation grid ─────────────────────── */}
        <section className={cn('bg-card flex flex-col overflow-hidden rounded-[4px] border shadow-sm lg:min-h-0', PANEL)}>
          <div className={DOC_BAR}>
            <span className={DOC_TITLE}>
              Ledger Summary — {ownerLabel || 'no party selected'}
              {isAgent && <span className="ml-1 opacity-70">(agent)</span>}
            </span>
            {/* The two browse/export actions live here rather than in a header
                strip of their own — same row, no extra vertical space. */}
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="hidden text-[11px] font-bold tracking-wide text-white uppercase tabular-nums lg:inline">
                {payMode ? `${bucket} leg` : 'Pick a mode'}
                {ctxLoading && ownerChosen && <Loader2 className="ml-1.5 inline size-3 animate-spin align-[-2px]" />}
              </span>
              <button
                type="button"
                onClick={() => (ownerChosen ? setLedgerOpen(true) : toast.error('Please select PARTY NAME or AGENT NAME first.'))}
                title="View this party's receipts (Ctrl+E)"
                className="flex cursor-pointer items-center gap-1 rounded-[3px] px-1.5 py-1 text-[11px] font-bold tracking-wide text-amber-200 uppercase transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
              >
                <ScrollText className="size-3.5" /> <span className="hidden sm:inline">View receipts</span>
              </button>
              <button
                type="button"
                onClick={exportPending}
                disabled={!invoices.length}
                title="Download the pending invoices to Excel"
                className="flex cursor-pointer items-center gap-1 rounded-[3px] px-1.5 py-1 text-[11px] font-bold tracking-wide text-amber-200 uppercase transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Download className="size-3.5" /> <span className="hidden sm:inline">Excel</span>
              </button>
            </div>
          </div>

          {/* The six figures the legacy form prints above its grid. */}
          <dl className="grid shrink-0 grid-cols-2 gap-px border-b border-amber-400 bg-amber-200/60 sm:grid-cols-3 lg:grid-cols-6 dark:border-amber-400/50 dark:bg-amber-400/20">
            <Fig label="Opening Bal" value={openingDisplay} />
            <Fig label="Invoices O/S" value={invoiceOutstanding} />
            <Fig label="Current O/S" value={currentOutstanding} strong />
            <Fig label="Remaining Bal" value={remainingBalance} />
            <Fig label="O/S After Adj" value={outstandingAfterAdj} strong />
            <Fig label="To Advance" value={preview.advanceToSave} tone={preview.advanceToSave > 0 ? 'amber' : undefined} />
          </dl>

          {/* Desktop grid. */}
          <div className={cn('hidden overflow-x-auto overscroll-x-contain sm:block lg:min-h-0 lg:flex-1 lg:overflow-auto', '[scrollbar-width:thin] [scrollbar-color:var(--color-amber-400)_var(--color-amber-100)]')}>
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Pending invoices for {ownerLabel || 'the selected party'}</caption>
              <thead>
                <tr>
                  {adjMode === 'AGST REF' && <th scope="col" className={cn(TH, TH_LINE, 'w-9 text-center')}>Sel</th>}
                  <th scope="col" className={cn(TH, TH_LINE, 'w-24')}>Inv Date</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-32')}>Inv No</th>
                  {isAgent && <th scope="col" className={cn(TH, TH_LINE)}>Party</th>}
                  <th scope="col" className={cn(TH, TH_LINE)}>Transaction</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-24')}>Due Date</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-24')}>Status</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>{payMode ? `${bucket} Amt` : 'Amount'}</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>Clear Amt</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>Bal Amt</th>
                  <th scope="col" className={cn(TH, 'w-20')}>Due</th>
                </tr>
              </thead>
              <tbody className="select-none">
                {!ownerChosen ? (
                  <tr>
                    <td colSpan={gridCols} className="text-muted-foreground h-28 text-center text-[13px] font-medium">
                      Select a Party or an Agent to load pending invoices.
                    </td>
                  </tr>
                ) : ctxLoading && !ctx ? (
                  <tr>
                    <td colSpan={gridCols} className="h-28 text-center"><Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" /></td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={gridCols} className="text-muted-foreground h-28 text-center text-[13px] font-medium">
                      Nothing pending on the {bucket.toLowerCase()} leg — everything is settled.
                    </td>
                  </tr>
                ) : (
                  invoices.map((r) => {
                    const amt = displayAmt(r);
                    const adj = preview.adjByInv.get(r.invNo) ?? 0;
                    const bal = Math.max(0, Math.round((amt - adj) * 100) / 100);
                    const ticked = selected.includes(r.invNo);
                    const style = DUE_STYLE[r.dueType] ?? DUE_STYLE.NORMAL;
                    const selectable = adjMode === 'AGST REF';
                    return (
                      <tr
                        key={r.invNo}
                        role={selectable ? 'button' : undefined}
                        tabIndex={selectable ? 0 : undefined}
                        aria-pressed={selectable ? ticked : undefined}
                        onClick={selectable ? () => toggleSel(r.invNo) : undefined}
                        onKeyDown={
                          selectable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleSel(r.invNo);
                                }
                              }
                            : undefined
                        }
                        className={cn(
                          'border-b border-amber-200/70 outline-none dark:border-amber-400/10',
                          ticked ? 'bg-sky-100/90 dark:bg-sky-400/20' : style.row,
                          'hover:bg-amber-200/70 dark:hover:bg-amber-400/20',
                          'focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-inset',
                          selectable && 'cursor-pointer',
                        )}
                      >
                        {selectable && (
                          <td className={cn(TD, 'text-center')}>
                            <input
                              type="checkbox"
                              className="pointer-events-none size-3.5 accent-blue-600"
                              checked={ticked}
                              readOnly
                              tabIndex={-1}
                              aria-label={`Select invoice ${r.invNo}`}
                            />
                          </td>
                        )}
                        <td className={cn(TD, 'whitespace-nowrap font-semibold tabular-nums text-slate-700 dark:text-slate-300')}>{prettyDate(r.invDate)}</td>
                        <td className={cn(TD, 'font-mono text-[12.5px] font-bold whitespace-nowrap text-slate-800 dark:text-slate-200')}>{r.invNo}</td>
                        {isAgent && <td className={cn(TD, 'font-semibold text-slate-800 dark:text-slate-200')}>{r.customerName}</td>}
                        <td className={cn(TD, 'text-[12px] font-medium text-slate-600 dark:text-slate-400')}>{txnLabel(r.transaction)}</td>
                        <td className={cn(TD, 'whitespace-nowrap font-semibold tabular-nums text-slate-700 dark:text-slate-300')}>{prettyDate(r.dueDate)}</td>
                        <td className={TD}>
                          <span className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-bold whitespace-nowrap ring-1 ring-inset', style.chip)}>{r.dueType}</span>
                        </td>
                        <td className={cn(TD, NUM, 'font-semibold text-slate-900 dark:text-slate-100')}>{inr(amt)}</td>
                        <td className={cn(TD, NUM, adj > 0 ? 'font-bold text-blue-700 dark:text-blue-400' : 'text-muted-foreground/50')}>{adj ? inr(adj) : '-'}</td>
                        <td className={cn(TD, NUM, 'font-semibold', bal <= 0.004 && 'text-emerald-700 dark:text-emerald-400')}>{inr(bal)}</td>
                        <td className={cn(TD, 'text-[11.5px] font-bold whitespace-nowrap', style.text)}>{r.dueDays}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {invoices.length > 0 && (
                <tfoot className="sticky bottom-0 z-20">
                  <tr className="bg-amber-200/90 font-bold shadow-[inset_0_2px_0_0_var(--color-amber-700)] dark:bg-amber-400/20 dark:shadow-[inset_0_2px_0_0_var(--color-amber-400)]">
                    {/* Leading filler spans every column before Status, so the
                        three figures land exactly under Amount / Clear / Bal. */}
                    <td className={TD} colSpan={gridCols - 5} />
                    <td className={cn(TD, 'text-[11px] font-extrabold tracking-wide text-amber-950 uppercase dark:text-amber-100')}>Total</td>
                    <td className={cn(TD, NUM, 'text-[13.5px] font-extrabold')}>{inr(invoiceOutstanding)}</td>
                    <td className={cn(TD, NUM, 'text-[13.5px] font-extrabold text-blue-700 dark:text-blue-400')}>{preview.adjTotal ? inr(preview.adjTotal) : '-'}</td>
                    <td className={cn(TD, NUM, 'text-[13.5px] font-extrabold')}>{inr(Math.max(0, invoiceOutstanding - preview.adjTotal))}</td>
                    <td className={TD} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Phones: one card per pending invoice instead of an 11-column grid. */}
          <div className="space-y-2 p-2 sm:hidden">
            {!ownerChosen ? (
              <p className="text-muted-foreground px-4 py-10 text-center text-[13px] font-medium">Select a Party or an Agent to load pending invoices.</p>
            ) : ctxLoading && !ctx ? (
              <div className="flex h-24 items-center justify-center"><Loader2 className="text-muted-foreground size-5 animate-spin" /></div>
            ) : invoices.length === 0 ? (
              <p className="text-muted-foreground px-4 py-10 text-center text-[13px] font-medium">Nothing pending on the {bucket.toLowerCase()} leg.</p>
            ) : (
              invoices.map((r) => {
                const amt = displayAmt(r);
                const adj = preview.adjByInv.get(r.invNo) ?? 0;
                const bal = Math.max(0, Math.round((amt - adj) * 100) / 100);
                const ticked = selected.includes(r.invNo);
                const style = DUE_STYLE[r.dueType] ?? DUE_STYLE.NORMAL;
                const selectable = adjMode === 'AGST REF';
                return (
                  <div
                    key={r.invNo}
                    role={selectable ? 'button' : undefined}
                    tabIndex={selectable ? 0 : undefined}
                    aria-pressed={selectable ? ticked : undefined}
                    onClick={selectable ? () => toggleSel(r.invNo) : undefined}
                    className={cn(
                      'rounded-[4px] border border-amber-200 p-2.5 shadow-sm dark:border-amber-400/20',
                      ticked ? 'bg-sky-100/90 dark:bg-sky-400/20' : style.row,
                      selectable && 'cursor-pointer active:brightness-95',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        {selectable && <input type="checkbox" readOnly checked={ticked} tabIndex={-1} className="pointer-events-none mt-0.5 size-4 shrink-0 accent-blue-600" aria-label={`Select invoice ${r.invNo}`} />}
                        <div className="min-w-0">
                          <p className="font-mono text-[13px] font-bold text-slate-900 dark:text-slate-100">{r.invNo}</p>
                          <p className="text-muted-foreground truncate text-[11.5px] font-medium">{txnLabel(r.transaction)} · {prettyDate(r.invDate)}</p>
                          {isAgent && <p className="truncate text-[12px] font-semibold">{r.customerName}</p>}
                        </div>
                      </div>
                      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold ring-1 ring-inset', style.chip)}>{r.dueType}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 border-t border-amber-300/50 pt-2 text-[12.5px] dark:border-amber-400/20">
                      <div>
                        <p className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">{payMode ? bucket : 'Amount'}</p>
                        <p className="font-bold tabular-nums">{inr(amt)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">Clear</p>
                        <p className={cn('font-bold tabular-nums', adj > 0 ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground/50')}>{adj ? inr(adj) : '-'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">Balance</p>
                        <p className="font-bold tabular-nums">{inr(bal)}</p>
                      </div>
                    </div>
                    <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-[11.5px]">
                      <span>Due {prettyDate(r.dueDate)}</span>
                      <span className={cn('font-bold', style.text)}>{r.dueDays}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* ── Ageing rail — bank and cash counted independently, exactly as the
             legacy overview panels do. ─────────────────────────────────────── */}
      <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2.5">
        {(['NORMAL', 'PAST DUE', 'OVERDUE'] as const).map((k) => (
          <DueCard key={k} kind={k} v={buckets[k]} activeBucket={payMode ? bucket : null} />
        ))}
      </div>

      {/* ── Save result ──────────────────────────────────────────────────── */}
      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="size-5 text-emerald-600" /> Receipt saved
            </DialogTitle>
            <DialogDescription>Voucher No <b className="font-mono text-foreground">{result?.voucherNo}</b></DialogDescription>
          </DialogHeader>
          <div className="space-y-1 rounded-[4px] border border-amber-300 bg-amber-50/70 p-2.5 text-[13px] dark:border-amber-400/30 dark:bg-amber-400/10">
            <p className="flex justify-between"><span>Opening cleared</span><b className="tabular-nums">{money(result?.openingCleared)}</b></p>
            <p className="flex justify-between"><span>Invoices cleared</span><b className="tabular-nums">{money(result?.invoicesCleared)}</b></p>
            <p className="flex justify-between border-t border-amber-600/30 pt-1 dark:border-amber-400/30"><span>Advance saved</span><b className="tabular-nums">{money(result?.advanceParked)}</b></p>
            {result?.receiptRefId && <p className="text-muted-foreground pt-0.5 text-[11.5px]">Receipt REF: <span className="font-mono">{result.receiptRefId}</span></p>}
            {result?.advanceRefId && <p className="text-muted-foreground text-[11.5px]">Advance REF: <span className="font-mono">{result.advanceRefId}</span></p>}
          </div>
          {!!result?.allocations?.length && (
            <div className="max-h-56 overflow-auto rounded-[4px] border">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className={cn(TH, TH_LINE)}>What</th>
                    <th className={cn(TH, TH_LINE)}>Invoice</th>
                    <th className={cn(TH, TH_LINE)}>Funded by</th>
                    <th className={cn(TH, 'text-right')}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {result.allocations.map((a, i) => (
                    <tr key={i} className="border-b border-amber-200/70 even:bg-amber-50/70 dark:border-amber-400/10 dark:even:bg-amber-400/[0.05]">
                      <td className={TD}>{a.kind === 'OPENING' ? 'Opening' : a.kind === 'INVOICE' ? 'Invoice' : 'Advance'}</td>
                      <td className={cn(TD, 'font-mono text-[11.5px]')}>{a.invNo ?? a.customerName}</td>
                      <td className={cn(TD, 'font-mono text-[11.5px]')}>{a.fundedBy}</td>
                      <td className={cn(TD, NUM, 'font-bold')}>{inr(a.amount)}</td>
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

      {ledgerOpen && (
        <LedgerModal
          ownerKind={isAgent ? 'Agent' : 'Party'}
          owner={ownerLabel}
          customerId={isAgent ? undefined : customerId}
          agentName={isAgent ? agent : undefined}
          onClose={() => setLedgerOpen(false)}
        />
      )}
    </div>
  );
}

/** One of the six figures in the ledger-summary strip. */
function Fig({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: 'amber' }) {
  return (
    <div className="bg-card min-w-0 px-2 py-1">
      <dt className="truncate text-[11px] font-bold tracking-widest text-amber-900/70 uppercase dark:text-amber-200/60">{label}</dt>
      <dd
        className={cn(
          'truncate tabular-nums',
          strong ? 'text-[15px] font-extrabold' : 'text-[14px] font-bold',
          tone === 'amber' && value > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100',
        )}
        title={inr(value)}
      >
        {moneyOrDash(value)}
      </dd>
    </div>
  );
}

/** A line in the voucher's live allocation read-out. */
function AllocLine({ label, value, tone }: { label: string; value: number; tone?: 'amber' }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-amber-900/80 dark:text-amber-200/70">{label}</span>
      <span className={cn('font-bold tabular-nums', tone === 'amber' && value > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-slate-800 dark:text-slate-200')}>
        {moneyOrDash(value)}
      </span>
    </div>
  );
}

/** One ageing bucket — bank and cash side by side, the leg in play highlighted. */
function DueCard({
  kind,
  v,
  activeBucket,
}: {
  kind: 'NORMAL' | 'PAST DUE' | 'OVERDUE';
  v: { bank: number; cash: number; bankCount: number; cashCount: number };
  activeBucket: 'BANK' | 'CASH' | null;
}) {
  const tone =
    kind === 'NORMAL'
      ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-400/30 dark:bg-emerald-400/[0.07]'
      : kind === 'PAST DUE'
        ? 'border-amber-300 bg-amber-50/70 dark:border-amber-400/30 dark:bg-amber-400/[0.07]'
        : 'border-rose-300 bg-rose-50/70 dark:border-rose-400/30 dark:bg-rose-400/[0.07]';
  const head =
    kind === 'NORMAL'
      ? 'text-emerald-800 dark:text-emerald-300'
      : kind === 'PAST DUE'
        ? 'text-amber-800 dark:text-amber-300'
        : 'text-rose-700 dark:text-rose-300';
  return (
    <div className={cn('rounded-[4px] border px-2.5 py-1.5 shadow-sm', tone)}>
      <p className={cn('text-[10px] font-extrabold tracking-widest uppercase', head)}>{kind} Due&apos;s</p>
      <div className="mt-0.5 flex items-baseline justify-between gap-3">
        <span className={cn('min-w-0 truncate text-[13px] tabular-nums', activeBucket === 'BANK' ? 'font-extrabold text-slate-900 dark:text-slate-100' : 'font-medium text-slate-600 dark:text-slate-400')}>
          Bank <span className="text-[10.5px] opacity-70">({v.bankCount})</span> {inr(v.bank)}
        </span>
        <span className={cn('min-w-0 truncate text-[13px] tabular-nums', activeBucket === 'CASH' ? 'font-extrabold text-slate-900 dark:text-slate-100' : 'font-medium text-slate-600 dark:text-slate-400')}>
          Cash <span className="text-[10.5px] opacity-70">({v.cashCount})</span> {inr(v.cash)}
        </span>
      </div>
    </div>
  );
}

/**
 * Correct an already-saved receipt's amount/date/mode/remarks. WHO it was
 * taken from and HOW it was adjusted (adjMode, ticked invoices) stay fixed —
 * only the figures a typo could get wrong are editable here. Saving reverses
 * this voucher and every later one for the same party/agent, then replays
 * them — see PaymentsService.editReceipt.
 */
function EditPaymentDialog({ entry, onClose }: { entry: LedgerEntryDto; onClose: () => void }) {
  const edit = useEditPayment();
  const { data: banks } = useActiveBankAccounts();
  const bankOptions = useMemo(() => (banks ?? []).map((b) => b.display), [banks]);

  const [payMode, setPayMode] = useState(entry.transMode);
  const [bankName, setBankName] = useState(entry.bankName ?? '');
  const [chequeNo, setChequeNo] = useState(entry.chequeNo ?? '');
  const [cashLoc, setCashLoc] = useState(entry.cashTransLocation ?? '');
  const [cashBy, setCashBy] = useState(entry.cashRecBy ?? '');
  const [receiptStr, setReceiptStr] = useState(String(entry.bankCredit || entry.cashCredit || ''));
  const [recDate, setRecDate] = useState(entry.transDate.slice(0, 10));
  const [remarks, setRemarks] = useState(entry.transRemarks ?? '');

  const receipt = parseAmount(receiptStr);
  const needsBank = payMode === 'BANK' || payMode === 'CHEQUE';

  const submit = () => {
    if (!payMode) return toast.error('Please select Payment Mode (BANK / CHEQUE / CASH).');
    if (!(receipt > 0)) return toast.error('Receipt Amount must be greater than 0.');
    if (needsBank && !bankName.trim()) return toast.error('Please select a Bank Name.');
    if (payMode === 'CHEQUE' && !chequeNo.trim()) return toast.error('Please select / enter Cheque No.');
    if (payMode === 'CASH' && !cashLoc.trim()) return toast.error('Please enter Cash Transfer Location.');
    if (payMode === 'CASH' && !cashBy.trim()) return toast.error('Please enter Cash Received By.');

    edit.mutate(
      {
        id: entry.id,
        payMode,
        bankName: bankName || null,
        chequeNo: chequeNo || null,
        cashTransLocation: cashLoc || null,
        cashRecBy: cashBy || null,
        receiptAmt: receipt,
        recDate,
        remarks: remarks || null,
      },
      {
        onSuccess: (res) => {
          toast.success(res.replayedCount > 0 ? `${entry.voucherNo} updated — ${res.replayedCount} later receipt(s) recomputed` : `${entry.voucherNo} updated`);
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Edit failed')),
      },
    );
  };

  useSaveShortcut(submit);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="text-primary size-4" /> Edit {entry.voucherNo}
          </DialogTitle>
          <DialogDescription>
            {entry.customerName} — correcting the amount replays this voucher and any later receipt for the same party/agent, so their numbers stay consistent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label htmlFor="edit-date" className={FIELD_LABEL}>Receipt Date *</Label>
              <DatePicker id="edit-date" value={recDate} onChange={(v) => v && setRecDate(v)} clearable={false} className={cn(CONTROL, 'w-full')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-amt" className={FIELD_LABEL}>Receipt Amount *</Label>
              <Input id="edit-amt" type="number" inputMode="decimal" className={CONTROL} value={receiptStr} onChange={(e) => setReceiptStr(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <span className={FIELD_LABEL}>Payment Mode *</span>
            <div role="group" aria-label="Payment mode" className="grid grid-cols-3 gap-0.5 rounded-[4px] border border-amber-400 bg-amber-50/40 p-0.5 dark:border-amber-400/60 dark:bg-transparent">
              {(['BANK', 'CHEQUE', 'CASH'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={payMode === m}
                  onClick={() => setPayMode(m)}
                  className={cn(
                    'min-h-9 cursor-pointer rounded-[3px] py-1.5 text-[11.5px] font-bold tracking-wide uppercase transition-colors duration-150',
                    payMode === m ? 'bg-primary text-primary-foreground shadow-sm' : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {needsBank && (
            <div className="space-y-1">
              <Label htmlFor="edit-bank" className={FIELD_LABEL}>Bank Name *</Label>
              <NativeSelect id="edit-bank" value={bankName} onChange={setBankName} options={bankOptions} placeholder="Our receiving account…" className={cn(CONTROL, 'font-medium')} />
            </div>
          )}
          {payMode === 'CHEQUE' && (
            <div className="space-y-1">
              <Label htmlFor="edit-cheque" className={FIELD_LABEL}>Cheque No *</Label>
              <Input id="edit-cheque" className={CONTROL} value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
            </div>
          )}
          {payMode === 'CASH' && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label htmlFor="edit-cashloc" className={FIELD_LABEL}>Cash Location *</Label>
                <Input id="edit-cashloc" className={CONTROL} value={cashLoc} onChange={(e) => setCashLoc(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-cashby" className={FIELD_LABEL}>Received By *</Label>
                <Input id="edit-cashby" className={CONTROL} value={cashBy} onChange={(e) => setCashBy(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="edit-remarks" className={FIELD_LABEL}>Remarks</Label>
            <Input id="edit-remarks" className={CONTROL} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={edit.isPending}>
            {edit.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── View Receipts browser (legacy Button1 / Ctrl+E) ────────────────────────── */

function LedgerModal({ ownerKind, owner, customerId, agentName, onClose }: { ownerKind: string; owner: string; customerId?: number; agentName?: string; onClose: () => void }) {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const canEdit = can('payment:update');
  const canDelete = can('payment:delete');
  const showActions = canEdit || canDelete;
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<LedgerEntryDto | null>(null);
  // Browsable date range — opens on the current financial year (the old fixed
  // window), but the user can point it anywhere: last FY, one month, one day.
  const [dateFrom, setDateFrom] = useState(fyStart());
  const [dateTo, setDateTo] = useState(TODAY());
  const del = useDeletePayment();
  const delMany = useDeletePayments();
  /*
   * Ticked receipts, by ledger id.
   *
   * CLEARED whenever the query changes (page, dates, side) — deliberately
   * unlike the Customers master, which keeps a selection across pages. This
   * button deletes money vouchers, and a set built up out of rows that are no
   * longer on screen is one nobody can check before confirming. What you can
   * see is what you can delete.
   */
  const [picked, setPicked] = useState<Set<number>>(new Set());
  /** 'BOTH' | 'B' | 'C' — which money side to show. Sent to the server so the
   *  row count and the rows agree; see the control below. */
  const [mode, setMode] = useState<'BOTH' | 'B' | 'C'>('BOTH');
  const { data, isLoading } = usePaymentLedger({ customerId, agentName, dateFrom, dateTo, mode, page, pageSize: 25 });
  const rows = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  // Opened from a party or an agent, whose name is already the dialog's title —
  // repeating it on every row cost three wrapped lines per row and told the
  // reader nothing. The column only earns its place on an unscoped ledger.
  const scoped = customerId != null || !!agentName;
  // +1 for the tick column, which only appears when deleting is possible.
  const cols = (scoped ? 7 : 8) + (showActions ? 1 : 0) + (canDelete ? 1 : 0);
  const bankTotal = rows.reduce((s, r) => s + (r.bankCredit ?? 0), 0);
  const cashTotal = rows.reduce((s, r) => s + (r.cashCredit ?? 0), 0);

  /*
   * Only rows that can ACTUALLY be deleted are tickable.
   *
   * A checkbox on a row the server would refuse — a credit note, or a receipt
   * that predates edit support — is a trap: it ticks, it counts towards the
   * total, and then the whole delete fails naming a voucher the user could not
   * have known was the problem. Same test the row's own trash button uses.
   */
  const deletable = useMemo(() => rows.filter((r) => r.voucherType === 'RECEIPT' && r.editable), [rows]);
  const pickedRows = useMemo(() => deletable.filter((r) => picked.has(r.id)), [deletable, picked]);
  const pickedTotal = pickedRows.reduce((s, r) => s + (r.bankCredit || r.cashCredit || 0), 0);
  const allPickable = deletable.length > 0 && deletable.every((r) => picked.has(r.id));
  const busy = del.isPending || delMany.isPending;

  const togglePick = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllPickable = () =>
    setPicked(allPickable ? new Set() : new Set(deletable.map((r) => r.id)));

  // Any change of question empties the basket — see the comment on `picked`.
  useEffect(() => setPicked(new Set()), [page, dateFrom, dateTo, mode]);

  const handleDeleteMany = async () => {
    if (!pickedRows.length) return;
    const names = pickedRows.map((r) => r.voucherNo);
    const ok = await confirm({
      title: `Delete ${names.length} receipt${names.length === 1 ? '' : 's'}?`,
      description:
        `${names.join(', ')} — ${inr(pickedTotal)} in total will be removed. ` +
        'Every invoice and advance they settled goes back to pending, and any later receipt for these parties is re-applied automatically. This cannot be undone.',
      confirmText: `Delete ${names.length} receipt${names.length === 1 ? '' : 's'}`,
      destructive: true,
    });
    if (!ok) return;
    try {
      // `pickedRows`, never the raw `picked` set: a refetch between ticking and
      // confirming can leave an id in the set that is no longer deletable, and
      // sending it would fail the WHOLE batch over a row the confirmation never
      // listed. What was named is what gets sent.
      const res = await delMany.mutateAsync(pickedRows.map((r) => r.id));
      setPicked(new Set());
      toast.success(
        res.replayedCount > 0
          ? `${res.deleted.length} receipt(s) deleted — ${res.replayedCount} later receipt(s) recomputed`
          : `${res.deleted.length} receipt(s) deleted`,
      );
    } catch (e) {
      // The server refuses the whole set rather than deleting part of it, so
      // nothing has changed and the ticks are worth keeping for another go.
      toast.error(getApiErrorMessage(e, 'Delete failed — nothing was removed'));
    }
  };

  const handleDelete = async (r: LedgerEntryDto) => {
    const amount = inr(r.bankCredit || r.cashCredit);
    const ok = await confirm({
      title: `Delete ${r.voucherNo}?`,
      description:
        `${r.customerName} — ${amount} received on ${prettyDate(r.transDate)} will be removed. ` +
        'Every invoice and advance it settled goes back to pending, and any later receipt for this party is re-applied automatically. This cannot be undone.',
      confirmText: 'Delete receipt',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(r.id, {
      onSuccess: (res) =>
        toast.success(
          res.replayedCount > 0
            ? `${r.voucherNo} deleted — ${res.replayedCount} later receipt(s) recomputed`
            : `${r.voucherNo} deleted`,
        ),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };
  return (
    <>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* The dialog itself no longer scrolls — only the rows do, so the title,
          the date range and the totals stay put while a long ledger is read. */}
      {/* `overflow-y-hidden` is explicit: DialogContent's base sets
          `overflow-y-auto`, and tailwind-merge treats `overflow` and
          `overflow-y` as separate groups — a plain `overflow-hidden` would not
          displace it, leaving the dialog scrolling behind the inner scroller. */}
      <DialogContent className="flex max-h-[90dvh] w-[min(940px,96vw)] max-w-[96vw] flex-col overflow-hidden overflow-y-hidden sm:!max-w-[940px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <BookOpenCheck className="text-primary size-5" /> View Receipts — {ownerKind}: {owner}
          </DialogTitle>
          <DialogDescription>Every voucher in the chosen date range — opens on this financial year.</DialogDescription>
        </DialogHeader>
        {/* Date range — page resets on change so the first page of the NEW range
            shows, not page 4 of a range that may only have one. */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="ledger-from" className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">From</Label>
            <Input
              id="ledger-from"
              type="date"
              className="h-8 w-40 tabular-nums"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ledger-to" className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">To</Label>
            <Input
              id="ledger-to"
              type="date"
              className="h-8 w-40 tabular-nums"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => { setDateFrom(fyStart()); setDateTo(TODAY()); setPage(1); }}
            disabled={dateFrom === fyStart() && dateTo === TODAY()}
          >
            <RotateCcw className="size-3.5" /> This FY
          </Button>

          {/*
            * Bank / Cash, matching the Party Ledger's own segmented control so
            * the two screens read the same way.
            *
            * Filtered SERVER-side, not on the rows already fetched: this list is
            * paginated 25 at a time, and filtering a single page would show "3
            * of 240" while hiding the rest — the count and the rows have to come
            * from the same question.
            */}
          <div className="space-y-1">
            <span className="text-muted-foreground block text-[11px] font-bold tracking-wide uppercase">Side</span>
            <div
              role="group"
              aria-label="Filter by bank or cash"
              className="inline-flex h-8 overflow-hidden rounded-[4px] border border-amber-300 dark:border-amber-400/40"
            >
              {([['BOTH', 'Both'], ['B', 'Bank'], ['C', 'Cash']] as const).map(([v, label], i) => {
                const on = mode === v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    onClick={() => { setMode(v); setPage(1); }}
                    className={cn(
                      'cursor-pointer px-2.5 text-[12px] font-semibold transition-colors',
                      i > 0 && 'border-l border-amber-300 dark:border-amber-400/40',
                      on
                        ? v === 'B'
                          ? 'bg-blue-600 text-white'
                          : v === 'C'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-700 text-white'
                        : 'text-muted-foreground hover:bg-amber-50 dark:hover:bg-amber-400/10',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {/* Only present once something is ticked, so the dialog stays quiet the
            rest of the time — and so a destructive button is never sitting
            there waiting to be clicked by accident. */}
        {canDelete && pickedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-rose-300 bg-rose-50 px-2.5 py-2 dark:border-rose-400/40 dark:bg-rose-400/10">
            <p className="text-[12.5px] font-bold text-rose-900 tabular-nums dark:text-rose-200">
              {pickedRows.length} receipt{pickedRows.length === 1 ? '' : 's'} selected
              <span className="ml-2 font-extrabold">{inr(pickedTotal)}</span>
            </p>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="cursor-pointer text-[12px] font-semibold text-rose-700/80 underline-offset-2 hover:underline dark:text-rose-300/80"
            >
              <X className="mr-0.5 inline size-3 align-[-1px]" />
              Clear
            </button>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="destructive"
                className="h-8 rounded-[4px] text-[12.5px] font-bold"
                onClick={() => void handleDeleteMany()}
                disabled={busy}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Delete {pickedRows.length} receipt{pickedRows.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto rounded-[4px] border">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {canDelete && (
                  <th scope="col" className={cn(TH, TH_LINE, 'w-8')}>
                    {/* Covers the deletable rows on THIS page — the only ones a
                        tick can act on. Absent entirely when none of them are,
                        rather than offered as a control that does nothing. */}
                    {deletable.length > 0 && (
                      <span className="flex items-center justify-center">
                        <RowCheckbox
                          checked={allPickable}
                          onChange={toggleAllPickable}
                          label={allPickable ? 'Clear selection' : `Select all ${deletable.length} deletable receipts on this page`}
                          title={allPickable ? 'Clear selection' : `Select all ${deletable.length} deletable receipts on this page`}
                        />
                      </span>
                    )}
                  </th>
                )}
                <th scope="col" className={cn(TH, TH_LINE)}>Voucher</th>
                <th scope="col" className={cn(TH, TH_LINE)}>Date</th>
                {!scoped && <th scope="col" className={cn(TH, TH_LINE)}>Customer</th>}
                <th scope="col" className={cn(TH, TH_LINE)}>Mode</th>
                <th scope="col" className={cn(TH, TH_LINE)}>Particulars</th>
                <th scope="col" className={cn(TH, TH_LINE, 'text-right')}>Bank Cr</th>
                <th scope="col" className={cn(TH, TH_LINE, 'text-right')}>Cash Cr</th>
                <th scope="col" className={cn(TH, showActions && TH_LINE)}>Remarks</th>
                {showActions && <th scope="col" className={cn(TH, 'w-16')} />}
              </tr>
            </thead>
            <tbody className="select-none">
              {isLoading ? (
                <tr><td colSpan={cols} className="h-20 text-center"><Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={cols} className="text-muted-foreground h-20 text-center text-[13px] font-medium">No receipts recorded in this date range.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      'border-b border-amber-200/70 even:bg-amber-50/70 hover:bg-amber-200/70 dark:border-amber-400/10 dark:even:bg-amber-400/[0.05] dark:hover:bg-amber-400/20',
                      // A ticked row is tinted so a selection spread down a long
                      // page is visible without reading every checkbox.
                      picked.has(r.id) && 'bg-rose-50/80 even:bg-rose-50/80 dark:bg-rose-400/[0.10] dark:even:bg-rose-400/[0.10]',
                    )}
                  >
                    {canDelete && (
                      <td className="px-1 py-[3px] text-center">
                        {r.voucherType === 'RECEIPT' && r.editable && (
                          <RowCheckbox
                            checked={picked.has(r.id)}
                            onChange={() => togglePick(r.id)}
                            label={`Select ${r.voucherNo} for deletion`}
                            title={`Select ${r.voucherNo} for deletion`}
                          />
                        )}
                      </td>
                    )}
                    <td className={cn(TD, 'font-mono font-bold whitespace-nowrap')}>{r.voucherNo}</td>
                    <td className={cn(TD, 'font-semibold whitespace-nowrap tabular-nums')}>{prettyDate(r.transDate)}</td>
                    {!scoped && <td className={cn(TD, 'font-semibold')}>{r.customerName}</td>}
                    <td className={cn(TD, 'whitespace-nowrap')}>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                        {r.transMode}
                      </span>
                    </td>
                    <td className={cn(TD, 'max-w-56 truncate')} title={r.particulars ?? ''}>{r.particulars ?? '—'}</td>
                    {/* Only one of the two ever carries a figure, so the empty
                        side is dimmed right down and the eye lands on the money. */}
                    <td className={cn(TD, NUM, r.bankCredit ? 'font-bold' : 'text-muted-foreground/40')}>{r.bankCredit ? inr(r.bankCredit) : '–'}</td>
                    <td className={cn(TD, NUM, r.cashCredit ? 'font-bold' : 'text-muted-foreground/40')}>{r.cashCredit ? inr(r.cashCredit) : '–'}</td>
                    <td className={cn(TD, 'text-muted-foreground max-w-40 truncate')} title={r.transRemarks ?? ''}>{r.transRemarks ?? '—'}</td>
                    {showActions && (
                      <td className="px-1 py-[3px]">
                        {r.voucherType === 'RECEIPT' && (
                          <div className="flex items-center justify-center gap-0.5">
                            {canEdit && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <button
                                      type="button"
                                      disabled={!r.editable}
                                      onClick={() => setEditing(r)}
                                      className="text-muted-foreground hover:bg-amber-200/70 hover:text-amber-900 disabled:pointer-events-none disabled:opacity-30 inline-flex size-6 items-center justify-center rounded-[4px] dark:hover:bg-amber-400/20 dark:hover:text-amber-200"
                                      aria-label={`Edit ${r.voucherNo}`}
                                    >
                                      <Pencil className="size-3.5" />
                                    </button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-56">
                                  {r.editable ? 'Edit received amount / date / mode' : "Can't edit — predates edit support, or a later receipt for this party/agent does"}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {canDelete && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <button
                                      type="button"
                                      disabled={!r.editable || busy}
                                      onClick={() => handleDelete(r)}
                                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30 inline-flex size-6 items-center justify-center rounded-[4px]"
                                      aria-label={`Delete ${r.voucherNo}`}
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-56">
                                  {r.editable
                                    ? 'Delete this receipt — invoices it paid go back to pending'
                                    : "Can't delete — predates edit support, or a later receipt for this party/agent does"}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Totals live here rather than in a sticky <tfoot>: a sticky footer row
            inside the scroller overlays the last rows instead of displacing
            them. Here they stay visible however far the list is scrolled.
            Labelled "on this page" whenever the range spans more than one, so
            the figure is never mistaken for the range total. */}
        <DialogFooter className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-[4px] border px-3 py-2 shadow-sm sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="text-muted-foreground text-[12px] font-medium">
              {data?.total ?? 0} voucher(s) · Page <span className="text-foreground font-bold tabular-nums">{data?.page ?? page}</span> of{' '}
              <span className="text-foreground font-bold tabular-nums">{totalPages}</span>
            </p>
            {rows.length > 0 && (
              <p className="text-[12px] font-medium">
                <span className="text-muted-foreground">{totalPages > 1 ? 'On this page:' : 'Total:'}</span>{' '}
                {bankTotal > 0 && (
                  <span className="ml-1">
                    <span className="text-muted-foreground">bank</span>{' '}
                    <span className="font-bold tabular-nums">{inr(bankTotal)}</span>
                  </span>
                )}
                {cashTotal > 0 && (
                  <span className="ml-2">
                    <span className="text-muted-foreground">cash</span>{' '}
                    <span className="font-bold tabular-nums">{inr(cashTotal)}</span>
                  </span>
                )}
                <span className="ml-2 border-l pl-2">
                  <span className="text-muted-foreground">received</span>{' '}
                  <span className="font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">{inr(bankTotal + cashTotal)}</span>
                </span>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft /> Prev</Button>
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next <ChevronRight /></Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {editing && <EditPaymentDialog entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export default PaymentPage;
