import { useEffect, useMemo, useState } from 'react';
import { Check, FolderOpen, Loader2, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  computeNoteBreakup,
  noteItemAmount,
  type CustomerDto,
  type NoteDirectoryRow,
  type NoteItemInput,
  type NoteMode,
  type RecentSoldRow,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Combobox } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { openPdf } from '@/lib/pdf';
import { useCustomers } from '@/features/customers/use-customers';
import { fetchNote, useDeleteNote, useNextNoteNo, useNoteDirectory, useRecentSold, useSaveNote } from './use-notes';

const money = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
// Delegates to the shared formatter so this page follows the system-wide date format.
const prettyDate = (iso: string | null) => formatDate(iso);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const numOrU = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** Matches the Dispatch / Orders / Pending Challan grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';
/** House grid className block — typography/border/zebra treatment shared across list & entry tables. */
const GRID_CLASSES = [
  'font-sans text-[13px]',
  '[&_thead_th]:text-[13.5px] [&_thead_th]:font-extrabold [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:py-1.5',
  '[&_td]:py-1 [&_td]:px-3 [&_th]:px-3',
  '[&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 dark:[&_tbody_tr]:border-white/10',
  '[&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0',
  '[&_tbody_tr:nth-child(even)_td]:bg-slate-100/80 dark:[&_tbody_tr:nth-child(even)_td]:bg-white/[0.04]',
].join(' ');
/** History-browsing grid (Directory dialog) is click-to-reopen, so it gets the fuller
 *  house pattern: hover affordance on header + row, and text-selection suppressed. */
const DIRECTORY_GRID_CLASSES =
  GRID_CLASSES +
  ' [&_thead_th:hover]:from-blue-900 [&_thead_th:hover]:to-indigo-900 [&_tbody]:select-none [&_tbody_tr:hover:hover_td]:bg-amber-100/70 dark:[&_tbody_tr:hover:hover_td]:bg-amber-400/10';

/* ── Tally worksheet chrome — the same tokens the Party Ledger, Daybook and
   Receive Payment screens use, so this voucher reads as one of the family. ─── */

/** Small-caps caption above each control. */
const FIELD_LABEL = 'text-[10px] font-bold tracking-widest text-amber-900/70 uppercase dark:text-amber-200/60';
/** Sticky navy→indigo column strip. */
const TH =
  'sticky top-0 z-10 bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-left text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap dark:from-blue-900 dark:to-indigo-900';
const TH_LINE = 'border-r border-white/15';
const TD = 'border-r border-r-amber-200/80 px-2 py-[3px] align-middle dark:border-r-amber-400/15 last:border-r-0';
const NUM = 'text-right tabular-nums';
/** The frame around each worksheet pane. */
const PANEL = 'border-amber-300 dark:border-amber-400/30';
/** The dark document caption bar that tops each pane. */
const DOC_BAR = 'flex shrink-0 items-center justify-between gap-3 bg-slate-800 px-2.5 py-1 dark:bg-slate-900';
const DOC_TITLE = 'truncate text-[12px] font-extrabold tracking-wide text-amber-300 uppercase';

/** An item on the working note (input + the fields the grid shows). */
type Line = NoteItemInput & { gstRate?: number; invDate?: string };

const EMPTY_ENTRY = { product: '', design: '', unit: '', bags: '', pcs: '', kgs: '', box: '', price: '', comment: '', refInvNo: '', dispatchId: 0, pCategory: '', gstRate: 0, invDate: '' };

export function NotesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();

  const [mode, setMode] = useState<NoteMode>('DEBIT');
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [invDate, setInvDate] = useState(ymd(new Date()));
  const [party, setParty] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [entry, setEntry] = useState({ ...EMPTY_ENTRY });

  // Header charges / rates.
  const [packing, setPacking] = useState('');
  const [freight, setFreight] = useState('');
  const [pouch, setPouch] = useState('');
  const [tcs, setTcs] = useState('');
  const [billingRate, setBillingRate] = useState('');
  const [category, setCategory] = useState('');
  const [transName, setTransName] = useState('');
  const [paymentTerm, setPaymentTerm] = useState('0');
  const [noBill, setNoBill] = useState(false);
  const [noBillWithoutGst, setNoBillWithoutGst] = useState(false);
  const [remarks, setRemarks] = useState('');

  const [dirOpen, setDirOpen] = useState(false);

  const { data: customerData } = useCustomers({ page: 1, pageSize: 1000 });
  const custByName = useMemo(() => {
    const m = new Map<string, CustomerDto>();
    for (const c of customerData?.items ?? []) if (c.partyName) m.set(c.partyName, c);
    return m;
  }, [customerData]);
  const partyOptions = useMemo(() => [...custByName.keys()].sort((a, b) => a.localeCompare(b)), [custByName]);
  const customerId = party ? custByName.get(party)?.id : undefined;

  const { data: nextNo } = useNextNoteNo(mode);
  const { data: recentSold = [] } = useRecentSold(customerId);
  const saveMut = useSaveNote();
  const del = useDeleteNote();

  const voucherNo = editingCode ?? nextNo?.code ?? '…';

  // Live B/C breakup — identical math to the server.
  const breakup = useMemo(
    () =>
      computeNoteBreakup({
        items: lines,
        packing: numOrU(packing),
        freight: numOrU(freight),
        pouch: numOrU(pouch),
        billingRate: numOrU(billingRate),
        noBill,
        noBillWithoutGst,
      }),
    [lines, packing, freight, pouch, billingRate, noBill, noBillWithoutGst],
  );

  const resetHeaderFromCustomer = (name: string) => {
    const c = custByName.get(name);
    if (!c) return;
    setCategory(c.category ?? '');
    setTransName(c.transportName ?? '');
    setBillingRate(c.billingRate != null ? String(c.billingRate) : '');
    setPaymentTerm(c.creditPeriod != null ? String(c.creditPeriod) : '0');
    setPacking(c.packing != null ? String(c.packing) : '');
    setFreight(c.freight != null ? String(c.freight) : '');
  };

  const onPartyChange = (name: string) => {
    setParty(name);
    setLines([]);
    setEntry({ ...EMPTY_ENTRY });
    resetHeaderFromCustomer(name);
  };

  const resetForNew = () => {
    setEditingCode(null);
    setLines([]);
    setEntry({ ...EMPTY_ENTRY });
    setNoBill(false);
    setNoBillWithoutGst(false);
    setRemarks('');
    setInvDate(ymd(new Date()));
  };

  const switchMode = (m: NoteMode) => {
    if (m === mode) return;
    setMode(m);
    resetForNew();
  };

  // ── item entry ────────────────────────────────────────────────────────────
  const pickRecent = (idxStr: string) => {
    const i = Number(idxStr);
    const r = recentSold[i];
    if (!r) return;
    setEntry({
      product: r.productName,
      design: r.design,
      unit: r.unit,
      // Debit note pre-fills quantities from the sale; credit note starts blank (user enters return qty).
      bags: mode === 'DEBIT' ? String(r.bags || '') : '',
      pcs: mode === 'DEBIT' ? String(r.pcs || '') : '',
      kgs: mode === 'DEBIT' ? String(r.kgs || '') : '',
      box: mode === 'DEBIT' ? String(r.box || '') : '',
      price: String(r.price || ''),
      comment: '',
      refInvNo: r.invNo,
      dispatchId: r.dispatchId,
      pCategory: r.pCategory,
      gstRate: r.gstRate,
      invDate: r.invDate,
    });
  };

  const entryAmount = noteItemAmount({ bags: numOrU(entry.bags), pcs: numOrU(entry.pcs), kgs: numOrU(entry.kgs), box: numOrU(entry.box), unit: entry.unit, price: numOrU(entry.price) });

  const addLine = () => {
    if (!entry.product.trim()) return toast.error('Pick a product from the dropdown first.');
    const qtyOk = [entry.bags, entry.pcs, entry.kgs, entry.box].some((q) => Number(q) > 0);
    if (!qtyOk) return toast.error('Enter at least one quantity (Bags / Pcs / Kgs / Box).');
    const dup = lines.some((l) => (l.refInvNo ?? '') === entry.refInvNo && l.productName === entry.product && (l.design ?? '') === entry.design);
    if (dup) return toast.error('This item already exists (same Ref Inv + Product + Design).');
    setLines((prev) => [
      ...prev,
      {
        dispatchId: entry.dispatchId || undefined,
        refInvNo: entry.refInvNo || undefined,
        productName: entry.product,
        design: entry.design || undefined,
        bags: numOrU(entry.bags),
        pcs: numOrU(entry.pcs),
        kgs: numOrU(entry.kgs),
        box: numOrU(entry.box),
        unit: entry.unit || undefined,
        price: numOrU(entry.price),
        comment: entry.comment || undefined,
        pCategory: entry.pCategory || undefined,
        gstRate: entry.gstRate,
        invDate: entry.invDate,
      },
    ]);
    setEntry({ ...EMPTY_ENTRY });
  };

  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  // ── save ──────────────────────────────────────────────────────────────────
  const onSave = () => {
    if (!customerId) return toast.error('Select a customer.');
    if (!lines.length) return toast.error('Add at least one item.');
    saveMut.mutate(
      {
        mode,
        code: editingCode ?? undefined,
        invDate,
        customerId,
        customerName: party,
        category: category || undefined,
        transName: transName || undefined,
        paymentTerm: numOrU(paymentTerm),
        packing: numOrU(packing),
        freight: numOrU(freight),
        pouch: numOrU(pouch),
        tcs: numOrU(tcs),
        billingRate: numOrU(billingRate),
        remarks: remarks || undefined,
        noBill,
        noBillWithoutGst,
        items: lines.map((l) => ({ ...l, gstRate: l.gstRate })),
      },
      {
        onSuccess: (res) => {
          toast.success(`${mode === 'CREDIT' ? 'Credit' : 'Debit'} Note ${res.code} saved — ${money0(res.total)}`);
          resetForNew();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );
  };

  useSaveShortcut(onSave);

  // ── load an existing note for edit (from directory) ────────────────────────
  const loadForEdit = async (row: NoteDirectoryRow) => {
    try {
      const n = await fetchNote(row.mode, row.code);
      setMode(n.mode);
      setEditingCode(n.code);
      setInvDate(n.invDate.slice(0, 10));
      setParty(n.customerName);
      setCategory(n.category ?? '');
      setTransName(n.transName ?? '');
      setPaymentTerm(n.paymentTerm != null ? String(n.paymentTerm) : '0');
      setPacking(n.packing != null ? String(n.packing) : '');
      setFreight(n.freight != null ? String(n.freight) : '');
      setPouch(n.pouch != null ? String(n.pouch) : '');
      setTcs(n.tcs != null ? String(n.tcs) : '');
      setBillingRate(n.billingRate != null ? String(n.billingRate) : '');
      setNoBill(n.noBill);
      setNoBillWithoutGst(false);
      setRemarks(n.remarks ?? '');
      setLines(
        n.items.map((it) => ({
          dispatchId: it.dispatchId,
          refInvNo: it.refInvNo,
          productName: it.productName,
          design: it.design,
          bags: it.bags,
          pcs: it.pcs,
          kgs: it.kgs,
          box: it.box,
          unit: it.unit,
          price: it.price,
          comment: it.comment,
          pCategory: it.pCategory,
          gstRate: n.gst ?? 0,
        })),
      );
      setDirOpen(false);
      toast.success(`Editing ${n.code}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not load note'));
    }
  };

  const noteLabel = mode === 'CREDIT' ? 'Credit Note' : 'Debit Note';


  return (
    // Fills the viewport on desktop: the voucher pane stays put while only the
    // item grid scrolls. Below `lg` it falls back to a normal scrolling page.
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2.5 font-sans sm:gap-2.5 sm:p-3 lg:overflow-hidden">
      <div className="grid gap-2 sm:gap-2.5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(19rem,21rem)_1fr]">
        {/* ── Voucher pane: identity → charges → totals → commit ──────────── */}
        <section className={cn('bg-card flex flex-col overflow-hidden rounded-[4px] border shadow-sm lg:min-h-0', PANEL)}>
          <div className={DOC_BAR}>
            <span className={DOC_TITLE}>{editingCode ? `Edit ${noteLabel}` : noteLabel}</span>
            <span className="shrink-0 font-mono text-[11px] font-bold text-white tabular-nums">{voucherNo}</span>
          </div>

          <div className="space-y-2.5 p-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {/* Debit vs Credit is the most consequential choice on this screen — it
                flips the sign of the whole voucher — so it leads, as a segmented
                control rather than a dropdown. */}
            <div className="space-y-1">
              <span className={FIELD_LABEL}>Note Type *</span>
              <div role="group" aria-label="Note type" className="grid grid-cols-2 gap-0.5 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40 dark:bg-transparent">
                {(['DEBIT', 'CREDIT'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => switchMode(m)}
                    className={cn(
                      'min-h-11 cursor-pointer rounded-[3px] py-1.5 text-[11.5px] font-bold tracking-wide uppercase transition-colors duration-150 lg:min-h-8',
                      mode === m
                        ? m === 'DEBIT'
                          ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-700'
                          : 'bg-emerald-600 text-white shadow-sm'
                        : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                    )}
                  >
                    {m === 'DEBIT' ? 'Debit' : 'Credit'}
                  </button>
                ))}
              </div>
              <p className="text-muted-foreground text-[11px] leading-snug">
                {mode === 'DEBIT'
                  ? 'Debit note — the party owes MORE (squares off advances).'
                  : 'Credit note — the party owes LESS (clears opening, then invoices).'}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="n-date" className={FIELD_LABEL}>Date *</Label>
              <DatePicker id="n-date" value={invDate} onChange={(v) => v && setInvDate(v)} clearable={false} className={cn(CONTROL, 'w-full')} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="n-party" className={FIELD_LABEL}>Party Name *</Label>
              <NativeSelect
                id="n-party"
                value={party}
                onChange={onPartyChange}
                options={partyOptions}
                placeholder="Select party…"
                className={cn(CONTROL, 'font-medium', party && CONTROL_ON)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="n-cat" className={FIELD_LABEL}>Category</Label>
                <Input id="n-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={cn(CONTROL, 'uppercase')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="n-term" className={FIELD_LABEL}>Term (days)</Label>
                <Input id="n-term" value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} inputMode="numeric" className={cn(CONTROL, 'text-right tabular-nums')} />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="n-trans" className={FIELD_LABEL}>Transport</Label>
              <Input id="n-trans" value={transName} onChange={(e) => setTransName(e.target.value)} className={cn(CONTROL, 'uppercase')} />
            </div>

            {/* ── Charges ── */}
            <div className="space-y-2 rounded-[4px] border border-amber-300 bg-amber-50/50 p-2 dark:border-amber-400/30 dark:bg-amber-400/[0.07]">
              <span className="text-[10px] font-extrabold tracking-widest text-amber-900/80 uppercase dark:text-amber-200/70">Charges</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="n-pack" className={FIELD_LABEL}>Packing</Label>
                  <Input id="n-pack" value={packing} onChange={(e) => setPacking(e.target.value)} inputMode="decimal" className={cn(CONTROL, 'bg-background text-right tabular-nums')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="n-freight" className={FIELD_LABEL}>Freight</Label>
                  <Input id="n-freight" value={freight} onChange={(e) => setFreight(e.target.value)} inputMode="decimal" className={cn(CONTROL, 'bg-background text-right tabular-nums')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="n-pouch" className={FIELD_LABEL}>Box / Pouch</Label>
                  <Input id="n-pouch" value={pouch} onChange={(e) => setPouch(e.target.value)} inputMode="decimal" className={cn(CONTROL, 'bg-background text-right tabular-nums')} />
                </div>
                {mode === 'DEBIT' ? (
                  <div className="space-y-1">
                    <Label htmlFor="n-tcs" className={FIELD_LABEL}>TCS</Label>
                    <Input id="n-tcs" value={tcs} onChange={(e) => setTcs(e.target.value)} inputMode="decimal" className={cn(CONTROL, 'bg-background text-right tabular-nums')} />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="n-brate" className={FIELD_LABEL}>Billing Rate</Label>
                    <Input id="n-brate" value={billingRate} onChange={(e) => setBillingRate(e.target.value)} inputMode="decimal" placeholder="0 = full" className={cn(CONTROL, 'bg-background text-right tabular-nums')} />
                  </div>
                )}
              </div>
              {mode === 'DEBIT' && (
                <div className="space-y-1">
                  <Label htmlFor="n-brate2" className={FIELD_LABEL}>Billing Rate</Label>
                  <Input id="n-brate2" value={billingRate} onChange={(e) => setBillingRate(e.target.value)} inputMode="decimal" placeholder="0 = full bill" className={cn(CONTROL, 'bg-background text-right tabular-nums')} />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-amber-600/25 pt-1.5 dark:border-amber-400/25">
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold select-none">
                  <Switch checked={noBill} onCheckedChange={(v) => { setNoBill(v); if (!v) setNoBillWithoutGst(false); }} /> No Bill
                </label>
                {noBill && (
                  <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-[12px] font-medium select-none">
                    <Switch checked={noBillWithoutGst} onCheckedChange={setNoBillWithoutGst} /> Without GST
                  </label>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="n-rem" className={FIELD_LABEL}>Remarks</Label>
              <Input id="n-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" className={cn(CONTROL, 'uppercase')} />
            </div>
          </div>

          {/* Totals + commit, pinned to the foot so they're always reachable. */}
          <div className="shrink-0 border-t border-amber-300 dark:border-amber-400/30">
            <div className="space-y-0.5 bg-amber-50/60 px-2.5 py-2 dark:bg-amber-400/[0.07]">
              <Row2 label="Items total" value={money(breakup.tAmt)} />
              <Row2 label={`GST${breakup.gstPercent ? ` @ ${breakup.gstPercent}%` : ''}`} value={money(breakup.tax)} />
            </div>
            <div className={cn('flex items-center justify-between px-2.5 py-2 text-white', mode === 'DEBIT' ? 'bg-slate-800 dark:bg-slate-700' : 'bg-emerald-600')}>
              <span className="text-[11px] font-extrabold tracking-widest uppercase">{mode === 'DEBIT' ? 'Total Dr' : 'Total Cr'}</span>
              <span className="text-[16px] font-extrabold tabular-nums">{money0(breakup.total)}</span>
            </div>
            <div className="space-y-0.5 bg-amber-50/60 px-2.5 py-2 dark:bg-amber-400/[0.07]">
              <Row2 label="B (bank)" value={money0(breakup.b)} className="text-blue-700 dark:text-blue-400" />
              <Row2 label="C (cash)" value={money0(breakup.c)} className="text-emerald-700 dark:text-emerald-400" />
              <div className="mt-2 flex gap-2">
                <Button
                  onClick={onSave}
                  disabled={saveMut.isPending || !can('note:create')}
                  title={`${editingCode ? 'Update' : 'Save'} ${noteLabel} (Ctrl+S)`}
                  className="h-11 flex-[2] bg-emerald-600 font-bold text-white hover:bg-emerald-700 lg:h-10"
                >
                  {saveMut.isPending ? <Loader2 className="animate-spin" /> : <Check />} {editingCode ? 'UPDATE' : 'SAVE'}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetForNew}
                  className="h-11 flex-1 border-rose-200 font-semibold text-rose-600 hover:bg-rose-50 lg:h-10 dark:border-rose-400/40 dark:text-rose-400 dark:hover:bg-rose-400/10"
                >
                  <RotateCcw /> {editingCode ? 'CANCEL' : 'CLEAR'}
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Item workspace: add-line bar + the note's lines ─────────────── */}
        <section className={cn('bg-card flex flex-col overflow-hidden rounded-[4px] border shadow-sm lg:min-h-0', PANEL)}>
          <div className={DOC_BAR}>
            <span className={DOC_TITLE}>Items — {party || 'no party selected'}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="hidden text-[11px] font-bold tracking-wide text-white uppercase tabular-nums lg:inline">
                {lines.length} line{lines.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => setDirOpen(true)}
                title={`Browse past ${noteLabel}s`}
                className="flex cursor-pointer items-center gap-1 rounded-[3px] px-1.5 py-1 text-[11px] font-bold tracking-wide text-amber-200 uppercase transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
              >
                <FolderOpen className="size-3.5" /> <span className="hidden sm:inline">Directory</span>
              </button>
            </div>
          </div>

          {/* Add-line bar — the recent-sale picker leads, the figures sit in a
              tight strip beneath it, ADD closes the row. */}
          <div className="shrink-0 space-y-2 border-b border-amber-300 bg-amber-50/40 p-2 dark:border-amber-400/30 dark:bg-amber-400/[0.05]">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <div className="col-span-2 space-y-1 lg:col-span-3">
                <Label className={FIELD_LABEL}>Pick a past sale (last 12 months)</Label>
                <Combobox
                  value=""
                  onChange={pickRecent}
                  options={recentSold.map((r: RecentSoldRow, i) => ({ value: String(i), label: `${r.invNo} · ${r.productName}${r.design ? ` · ${r.design}` : ''} · ${money(r.price)}` }))}
                  placeholder={customerId ? 'Search a past sale…' : 'Select a party first'}
                  className={cn(CONTROL, 'w-full')}
                />
              </div>
              <div className="space-y-1"><Label className={FIELD_LABEL}>Product *</Label><Input value={entry.product} onChange={(e) => setEntry((s) => ({ ...s, product: e.target.value }))} className={cn(CONTROL, 'bg-background')} /></div>
              <div className="space-y-1"><Label className={FIELD_LABEL}>Design</Label><Input value={entry.design} onChange={(e) => setEntry((s) => ({ ...s, design: e.target.value }))} className={cn(CONTROL, 'bg-background')} /></div>
              <div className="space-y-1"><Label className={FIELD_LABEL}>Ref Inv</Label><Input value={entry.refInvNo} onChange={(e) => setEntry((s) => ({ ...s, refInvNo: e.target.value }))} className={cn(CONTROL, 'bg-background font-mono')} /></div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              <div className="space-y-1"><Label className={FIELD_LABEL}>Unit</Label><Input value={entry.unit} onChange={(e) => setEntry((s) => ({ ...s, unit: e.target.value }))} placeholder="KGS" className={cn(CONTROL, 'bg-background uppercase')} /></div>
              <div className="space-y-1"><Label className={FIELD_LABEL}>Bags</Label><Input value={entry.bags} onChange={(e) => setEntry((s) => ({ ...s, bags: e.target.value }))} inputMode="decimal" className={cn(CONTROL, 'bg-background text-right tabular-nums')} /></div>
              <div className="space-y-1"><Label className={FIELD_LABEL}>Pcs</Label><Input value={entry.pcs} onChange={(e) => setEntry((s) => ({ ...s, pcs: e.target.value }))} inputMode="decimal" className={cn(CONTROL, 'bg-background text-right tabular-nums')} /></div>
              <div className="space-y-1"><Label className={FIELD_LABEL}>Kgs</Label><Input value={entry.kgs} onChange={(e) => setEntry((s) => ({ ...s, kgs: e.target.value }))} inputMode="decimal" className={cn(CONTROL, 'bg-background text-right tabular-nums')} /></div>
              <div className="space-y-1"><Label className={FIELD_LABEL}>Box</Label><Input value={entry.box} onChange={(e) => setEntry((s) => ({ ...s, box: e.target.value }))} inputMode="decimal" className={cn(CONTROL, 'bg-background text-right tabular-nums')} /></div>
              <div className="space-y-1"><Label className={FIELD_LABEL}>Price</Label><Input value={entry.price} onChange={(e) => setEntry((s) => ({ ...s, price: e.target.value }))} inputMode="decimal" className={cn(CONTROL, 'bg-background text-right tabular-nums')} /></div>
              <div className="space-y-1"><Label className={FIELD_LABEL}>Amount</Label><Input value={money(entryAmount)} readOnly tabIndex={-1} className={cn(CONTROL, 'bg-muted/50 cursor-default text-right font-bold tabular-nums')} /></div>
              <div className="flex items-end">
                <Button type="button" onClick={addLine} className="h-9 w-full rounded-[4px] font-bold"><Plus className="size-3.5" /> ADD</Button>
              </div>
            </div>
            <Input value={entry.comment} onChange={(e) => setEntry((s) => ({ ...s, comment: e.target.value }))} placeholder="Line comment (optional)" className={cn(CONTROL, 'bg-background')} />
          </div>

          {/* Desktop line grid. */}
          <div className={cn('hidden overflow-x-auto overscroll-x-contain sm:block lg:min-h-0 lg:flex-1 lg:overflow-auto', '[scrollbar-width:thin] [scrollbar-color:var(--color-amber-400)_var(--color-amber-100)]')}>
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Lines on this {noteLabel}</caption>
              <thead>
                <tr>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-9 text-center')}>#</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-28')}>Ref Inv</th>
                  <th scope="col" className={cn(TH, TH_LINE)}>Product</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-24')}>Design</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-16 text-right')}>Bags</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-16 text-right')}>Pcs</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-16 text-right')}>Kgs</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-16 text-right')}>Box</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-14')}>Unit</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-24 text-right')}>Price</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>Amount</th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-14 text-right')}>GST%</th>
                  <th scope="col" className={cn(TH, 'w-10')} aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-muted-foreground h-28 text-center text-[13px] font-medium">
                      {party ? 'No lines yet — pick a past sale or type a product above, then press ADD.' : 'Select a party to begin.'}
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={i} className="border-b border-amber-200/70 even:bg-amber-50/70 hover:bg-amber-200/70 dark:border-amber-400/10 dark:even:bg-amber-400/[0.05] dark:hover:bg-amber-400/20">
                      <td className={cn(TD, 'text-center text-[12px] font-bold text-slate-500 tabular-nums dark:text-slate-400')}>{i + 1}</td>
                      <td className={cn(TD, 'font-mono text-[12.5px] font-bold whitespace-nowrap')}>{l.refInvNo ?? '—'}</td>
                      <td className={cn(TD, 'font-semibold text-slate-800 dark:text-slate-200')}>{l.productName}</td>
                      <td className={cn(TD, 'text-[12px] font-medium text-slate-600 dark:text-slate-400')}>{l.design ?? '—'}</td>
                      <td className={cn(TD, NUM, 'font-semibold')}>{l.bags ?? '-'}</td>
                      <td className={cn(TD, NUM, 'font-semibold')}>{l.pcs ?? '-'}</td>
                      <td className={cn(TD, NUM, 'font-semibold')}>{l.kgs ?? '-'}</td>
                      <td className={cn(TD, NUM, 'font-semibold')}>{l.box ?? '-'}</td>
                      <td className={cn(TD, 'text-[11.5px] font-bold tracking-wide uppercase text-slate-500 dark:text-slate-400')}>{l.unit ?? '—'}</td>
                      <td className={cn(TD, NUM, 'font-semibold')}>{money(l.price ?? 0)}</td>
                      <td className={cn(TD, NUM, 'font-bold text-slate-900 dark:text-slate-100')}>{money(noteItemAmount(l))}</td>
                      <td className={cn(TD, NUM, 'text-[12px] font-medium text-slate-600 dark:text-slate-400')}>{l.gstRate ?? 0}</td>
                      <td className={cn(TD, 'text-center')}>
                        <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => removeLine(i)} aria-label={`Remove line ${i + 1}`}>
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot className="sticky bottom-0 z-20">
                  <tr className="bg-amber-200/90 font-bold shadow-[inset_0_2px_0_0_var(--color-amber-700)] dark:bg-amber-400/20 dark:shadow-[inset_0_2px_0_0_var(--color-amber-400)]">
                    <td className={TD} colSpan={9} />
                    <td className={cn(TD, 'text-[11px] font-extrabold tracking-wide text-amber-950 uppercase dark:text-amber-100')}>Total</td>
                    <td className={cn(TD, NUM, 'text-[13.5px] font-extrabold')}>{money(breakup.tAmt)}</td>
                    <td className={TD} colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Phones: one card per line. */}
          <div className="space-y-2 p-2 sm:hidden">
            {lines.length === 0 ? (
              <p className="text-muted-foreground px-4 py-8 text-center text-[13px] font-medium">
                {party ? 'No lines yet — add one above.' : 'Select a party to begin.'}
              </p>
            ) : (
              lines.map((l, i) => (
                <div key={i} className="rounded-[4px] border border-amber-200 bg-amber-50/60 p-2.5 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/[0.06]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-bold text-slate-900 dark:text-slate-100">{l.productName}{l.design ? ` · ${l.design}` : ''}</p>
                      {l.refInvNo && <p className="text-muted-foreground font-mono text-[11px]">Ref {l.refInvNo}</p>}
                      <p className="text-muted-foreground text-[11.5px]">
                        {[l.bags ? `${l.bags} bags` : null, l.pcs ? `${l.pcs} pcs` : null, l.kgs ? `${l.kgs} kgs` : null, l.box ? `${l.box} box` : null].filter(Boolean).join(' · ') || '—'}
                        {' · '}{money(l.price ?? 0)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[13.5px] font-extrabold tabular-nums">{money(noteItemAmount(l))}</span>
                      <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => removeLine(i)} aria-label={`Remove line ${i + 1}`}><Trash2 className="size-4" /></Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <NoteDirectoryDialog open={dirOpen} onOpenChange={setDirOpen} mode={mode} onEdit={loadForEdit} onDelete={del} canDelete={can('note:delete')} canPrint={can('note:print')} confirm={confirm} />
    </div>
  );
}

/** A label/value line in the totals card — same shape as Create Challan's. */
function Row2({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between text-[13px]', className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// ── Directory dialog ──────────────────────────────────────────────────────────
function NoteDirectoryDialog({
  open,
  onOpenChange,
  mode,
  onEdit,
  onDelete,
  canDelete,
  canPrint,
  confirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: NoteMode;
  onEdit: (r: NoteDirectoryRow) => void;
  onDelete: ReturnType<typeof useDeleteNote>;
  canDelete: boolean;
  canPrint: boolean;
  confirm: ReturnType<typeof useConfirm>;
}) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [payMode, setPayMode] = useState('ALL');
  const { data, isLoading } = useNoteDirectory({ mode, fromDate: fromDate || undefined, toDate: toDate || undefined, payMode });
  const rows = data?.items ?? [];

  const handleDelete = async (r: NoteDirectoryRow) => {
    const ok = await confirm({ title: `Delete ${r.code}?`, description: 'This reverses its ledger, receipts, advance and opening entries. This cannot be undone.', confirmText: 'Delete', destructive: true });
    if (!ok) return;
    onDelete.mutate({ mode: r.mode, code: r.code }, { onSuccess: () => toast.success(`${r.code} deleted`), onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')) });
  };

  const cols: DataColumn<NoteDirectoryRow>[] = [
    { id: 'code', label: 'No', cell: (r) => <span className={cn(TEXT_CELL, 'font-mono')}>{r.code}</span> },
    { id: 'date', label: 'Date', cell: (r) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{prettyDate(r.invDate)}</span> },
    { id: 'party', label: 'Customer', cell: (r) => <span className={TEXT_CELL}>{r.customerName}</span> },
    { id: 'b', label: 'B (bank)', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money0(r.b)}</span> },
    { id: 'c', label: 'C (cash)', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money0(r.c)}</span> },
    { id: 'total', label: 'Total', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums font-bold')}>{money0(r.total)}</span> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{mode === 'CREDIT' ? 'Credit Note' : 'Debit Note'} Directory</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-sm">From</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={cn(CONTROL, 'font-medium', fromDate && CONTROL_ON)} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={cn(CONTROL, 'font-medium', toDate && CONTROL_ON)} />
          </div>
          <div className="w-40 space-y-1">
            <Label className="text-sm">Pay Mode</Label>
            <NativeSelect value={payMode} onChange={setPayMode} options={['ALL', 'BANK', 'CASH', 'BOTH']} className={cn(CONTROL, 'font-medium', payMode && payMode !== 'ALL' && CONTROL_ON)} />
          </div>
          <div className="bg-card ml-auto rounded-[4px] border px-3 py-2 shadow-sm">
            <p className="text-muted-foreground text-[12px] font-medium">{rows.length} record{rows.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="max-h-[55vh] overflow-auto">
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(r) => r.code}
            isLoading={isLoading}
            emptyText="No notes for these filters."
            onRowClick={(r) => onEdit(r)}
            className={DIRECTORY_GRID_CLASSES}
            actions={(r) => (
              <div className="flex justify-end gap-1">
                {canPrint && (
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => openPdf(`/notes/${r.mode}/${encodeURIComponent(r.code)}/print.pdf`, `${r.mode}-${r.code}.pdf`.replace(/[\\/:*?"<>|]/g, '-'))} aria-label="Print">

                    <Printer className="size-4" />
                  </Button>
                )}
                {canDelete && (
                  <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(r)} aria-label="Delete">
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            )}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
