import { useEffect, useMemo, useState } from 'react';
import { Check, FolderOpen, Hash, Loader2, NotebookPen, Plus, Printer, RotateCcw, Trash2, UserSearch } from 'lucide-react';
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

  const lineCols: DataColumn<Line>[] = [
    { id: 'ref', label: 'Ref Inv', cell: (l) => <span className={cn(TEXT_CELL, 'font-mono')}>{l.refInvNo ?? '—'}</span> },
    { id: 'product', label: 'Product', cell: (l) => <span className={TEXT_CELL}>{l.productName}</span> },
    { id: 'design', label: 'Design', cell: (l) => <span className={TEXT_CELL}>{l.design ?? '—'}</span> },
    { id: 'bags', label: 'Bags', align: 'right', cell: (l) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{l.bags ?? '—'}</span> },
    { id: 'pcs', label: 'Pcs', align: 'right', cell: (l) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{l.pcs ?? '—'}</span> },
    { id: 'kgs', label: 'Kgs', align: 'right', cell: (l) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{l.kgs ?? '—'}</span> },
    { id: 'box', label: 'Box', align: 'right', cell: (l) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{l.box ?? '—'}</span> },
    { id: 'unit', label: 'Unit', cell: (l) => <span className={TEXT_CELL}>{l.unit ?? '—'}</span> },
    { id: 'price', label: 'Price', align: 'right', cell: (l) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(l.price ?? 0)}</span> },
    { id: 'amount', label: 'Amount', align: 'right', cell: (l) => <span className={cn(TEXT_CELL, 'tabular-nums font-bold')}>{money(noteItemAmount(l))}</span> },
    { id: 'gst', label: 'GST %', align: 'right', cell: (l) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{l.gstRate ?? 0}</span> },
  ];

  return (
    <div className="flex w-full flex-col gap-2 sm:gap-3">
      {/* Header — same compact bar as Create Challan: brand icon + title, mode
          toggle and Directory sit on the right instead of Save/Cancel (which
          live in the bottom action bar here, same as challan). */}
      <div className="bg-background/85 z-20 -mt-1 flex shrink-0 flex-wrap items-center gap-1.5 rounded-md py-1 backdrop-blur sm:gap-2">
        <div className="bg-gradient-brand flex size-8 items-center justify-center rounded-md text-white shadow-sm ring-1 ring-white/20">
          <NotebookPen className="size-4" />
        </div>
        <span className="text-muted-foreground shrink-0 text-sm font-semibold whitespace-nowrap">
          {editingCode ? `Edit ${noteLabel}` : `Create ${noteLabel}`} <span className="text-muted-foreground/60 hidden sm:inline">—</span>
        </span>
        {party && <span className="min-w-0 flex-1 truncate text-base font-bold tracking-tight">{party}</span>}
        <div className="ml-auto flex items-center gap-2">
          <div className="bg-muted inline-flex items-center gap-0.5 rounded-md p-0.5">
            {(['DEBIT', 'CREDIT'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn('rounded px-3 py-1 text-xs font-semibold capitalize transition-colors', mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {m === 'DEBIT' ? 'Debit Note' : 'Credit Note'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setDirOpen(true)}>
            <FolderOpen /> Directory
          </Button>
        </div>
      </div>

      {/* Note paper — same shell as the Create Challan invoice: a Bill-To block
          (party + its meta) beside a bordered 2×2 document-info panel. */}
      <div className="bg-card flex flex-col overflow-hidden rounded-md border shadow-sm">
        <div className="from-primary/[0.06] dark:from-primary/[0.12] shrink-0 border-b bg-gradient-to-br via-transparent to-sky-50/40 px-3 py-2.5 sm:px-4 dark:to-sky-500/[0.05]">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-stretch lg:gap-4">
            {/* Bill To */}
            <div className="bg-background/50 min-w-0 flex-1 space-y-1.5 rounded-md border border-l-[3px] border-border/50 border-l-primary/50 px-3 py-2 dark:bg-white/[0.03]">
              <span className="text-primary/70 flex items-center gap-1 text-[10px] font-bold tracking-widest uppercase">
                <UserSearch className="size-3.5" /> Bill To
              </span>
              <NativeSelect value={party} onChange={onPartyChange} options={partyOptions} placeholder="Select party…" className="bg-background h-9 w-full rounded-md text-base font-semibold" />
              {party && (
                <p className="text-muted-foreground truncate text-[12px]">
                  {[category, transName].filter(Boolean).join(' · ') || '—'}
                </p>
              )}

              {/* No Bill — same settlement row as the Bill-To card on Create Challan. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/50 pt-1.5">
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2 py-1 text-[13px] font-semibold transition-colors select-none',
                    noBill ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60',
                  )}
                  title="Bill without a tax invoice"
                >
                  <input type="checkbox" checked={noBill} onChange={(e) => { setNoBill(e.target.checked); if (!e.target.checked) setNoBillWithoutGst(false); }} className="size-3.5 accent-blue-600" />
                  No Bill
                  {noBill && <span className="text-[11px] font-medium text-amber-600 dark:text-amber-300">{noBillWithoutGst ? '(GST removed)' : '(GST kept)'}</span>}
                </label>
                {noBill && (
                  <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-[12px] font-medium select-none">
                    <Switch checked={noBillWithoutGst} onCheckedChange={setNoBillWithoutGst} /> Without GST
                  </label>
                )}
              </div>
            </div>

            {/* 2×2 document-info panel */}
            <div className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-md border bg-border/70 sm:w-[26rem] dark:bg-white/10">
              <MetaCell label="Voucher No" icon={Hash}>
                <span className="font-mono font-bold">{voucherNo}</span>
              </MetaCell>
              <MetaCell label="Date">
                <DatePicker value={invDate} onChange={setInvDate} clearable={false} className="bg-background h-8 w-full rounded-[4px] text-[13px]" />
              </MetaCell>
              <MetaCell label="Category">
                <Input value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 rounded-[4px] text-[13px]" />
              </MetaCell>
              <MetaCell label="Payment Term (days)">
                <Input value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} inputMode="numeric" className="h-8 rounded-[4px] text-[13px]" />
              </MetaCell>
            </div>
          </div>
        </div>

        {/* Add-line toolbar — same treated block as challan's, just with the
            recent-sold picker + manual fields always visible (there's no
            separate dispatched pool to pick from here). */}
        <div className="bg-muted/30 shrink-0 space-y-2 border-y px-3 py-2 sm:px-4 sm:py-2.5">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
            <div className="col-span-2 space-y-1 lg:col-span-2">
              <Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Product (from last 12 months' sales)</Label>
              <Combobox
                value=""
                onChange={pickRecent}
                options={recentSold.map((r: RecentSoldRow, i) => ({ value: String(i), label: `${r.invNo} · ${r.productName}${r.design ? ` · ${r.design}` : ''} · ${money(r.price)}` }))}
                placeholder={customerId ? 'Search a past sale…' : 'Select a party first'}
                className="h-9"
              />
            </div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Product Name</Label><Input value={entry.product} onChange={(e) => setEntry((s) => ({ ...s, product: e.target.value }))} className="h-8 rounded-[4px] text-[13px]" /></div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Design</Label><Input value={entry.design} onChange={(e) => setEntry((s) => ({ ...s, design: e.target.value }))} className="h-8 rounded-[4px] text-[13px]" /></div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Unit</Label><Input value={entry.unit} onChange={(e) => setEntry((s) => ({ ...s, unit: e.target.value }))} placeholder="KGS / PCS" className="h-8 rounded-[4px] text-[13px]" /></div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Ref Inv No</Label><Input value={entry.refInvNo} onChange={(e) => setEntry((s) => ({ ...s, refInvNo: e.target.value }))} className="h-8 rounded-[4px] font-mono text-[13px]" /></div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Bags</Label><Input value={entry.bags} onChange={(e) => setEntry((s) => ({ ...s, bags: e.target.value }))} inputMode="decimal" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Pcs</Label><Input value={entry.pcs} onChange={(e) => setEntry((s) => ({ ...s, pcs: e.target.value }))} inputMode="decimal" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Kgs</Label><Input value={entry.kgs} onChange={(e) => setEntry((s) => ({ ...s, kgs: e.target.value }))} inputMode="decimal" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Box</Label><Input value={entry.box} onChange={(e) => setEntry((s) => ({ ...s, box: e.target.value }))} inputMode="decimal" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Price</Label><Input value={entry.price} onChange={(e) => setEntry((s) => ({ ...s, price: e.target.value }))} inputMode="decimal" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
            <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Amount</Label><Input value={money(entryAmount)} readOnly className="h-8 rounded-[4px] bg-muted/40 text-right text-[13px] tabular-nums" /></div>
            <div className="col-span-2 space-y-1 lg:col-span-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Comment</Label><Input value={entry.comment} onChange={(e) => setEntry((s) => ({ ...s, comment: e.target.value }))} className="h-8 rounded-[4px] text-[13px]" /></div>
            <div className="flex items-end">
              <Button type="button" onClick={addLine} className="h-8 w-full rounded-[4px]"><Plus className="size-3.5" /> Add</Button>
            </div>
          </div>
        </div>

        {/* Line items — grows to show every row, page scrolls when long (same as challan). */}
        <div className="hidden sm:block">
          <DataTable
            columns={lineCols}
            rows={lines}
            rowKey={(l) => String(lines.indexOf(l))}
            dense
            emptyText="No items yet — pick a product above and click Add."
            className={cn(GRID_CLASSES, '[&_thead_th]:bg-gradient-to-b [&_thead_th]:from-blue-800 [&_thead_th]:to-indigo-800 [&_thead_th]:text-white')}
            actions={(l) => {
              const i = lines.indexOf(l);
              return (
                <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => removeLine(i)} aria-label="Remove">
                  <Trash2 className="size-4" />
                </Button>
              );
            }}
          />
        </div>

        {/* Phones: one card per line (the grid above is desktop/tablet only). */}
        <div className="space-y-2 p-2.5 sm:hidden">
          {lines.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm">No items yet — pick a product above and tap Add.</p>
          ) : (
            lines.map((l, i) => (
              <div key={i} className="bg-card flex items-start justify-between gap-2 rounded-md border p-2.5 shadow-sm">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold text-slate-900 dark:text-slate-100">{l.productName}{l.design ? ` · ${l.design}` : ''}</p>
                  <p className="text-muted-foreground text-[11.5px]">
                    {[l.bags ? `${l.bags} bags` : null, l.pcs ? `${l.pcs} pcs` : null, l.kgs ? `${l.kgs} kgs` : null, l.box ? `${l.box} box` : null].filter(Boolean).join(' · ') || '—'}
                    {' · '}{money(l.price ?? 0)}
                  </p>
                  {l.refInvNo && <p className="text-muted-foreground font-mono text-[11px]">Ref {l.refInvNo}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[13.5px] font-bold tabular-nums">{money(noteItemAmount(l))}</span>
                  <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => removeLine(i)} aria-label="Remove"><Trash2 className="size-4" /></Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Charges + breakup — same two-column layout (charges left, totals card right). */}
        <div className="grid grid-cols-1 gap-3 border-t p-3 sm:p-4 lg:grid-cols-3">
          <div className="space-y-2.5 lg:col-span-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Packing</Label><Input value={packing} onChange={(e) => setPacking(e.target.value)} inputMode="decimal" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
              <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Freight</Label><Input value={freight} onChange={(e) => setFreight(e.target.value)} inputMode="decimal" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
              <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Box / Pouch</Label><Input value={pouch} onChange={(e) => setPouch(e.target.value)} inputMode="decimal" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
              <div className="space-y-1">
                <Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Billing Rate</Label>
                <Input value={billingRate} onChange={(e) => setBillingRate(e.target.value)} inputMode="decimal" placeholder="0 = full bill" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" />
              </div>
              {mode === 'DEBIT' && (
                <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">TCS</Label><Input value={tcs} onChange={(e) => setTcs(e.target.value)} inputMode="decimal" className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Remarks</Label>
              <textarea
                className="border-input bg-background min-h-10 w-full rounded-[4px] border px-3 py-1.5 text-[13px]"
                placeholder="Remarks…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          <div className="order-1 self-start overflow-hidden rounded-[4px] border shadow-sm lg:order-2">
            <div className="bg-card space-y-0.5 p-2.5">
              <Row2 label="Items total" value={money(breakup.tAmt)} />
              <Row2 label={`GST${breakup.gstPercent ? ` @ ${breakup.gstPercent}%` : ''}`} value={money(breakup.tax)} />
            </div>
            <div className="bg-gradient-brand flex items-center justify-between px-3 py-2 text-base font-bold text-white">
              <span className="tracking-wide">TOTAL</span>
              <span className="tabular-nums">{money0(breakup.total)}</span>
            </div>
            <div className="bg-card space-y-1 p-2.5">
              <Row2 label="B (bank)" value={money0(breakup.b)} className="text-blue-600 dark:text-blue-400" />
              <Row2 label="C (cash)" value={money0(breakup.c)} className="text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom action bar — flows after the content, same as Create Challan. */}
      <div className="bg-background/95 z-30 -mx-1 mt-0.5 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t px-2 py-2 backdrop-blur sm:mt-1 sm:gap-y-2 sm:py-3">
        <p className="text-sm">
          {lines.length} item(s)
          {lines.length > 0 && (
            <>
              {' '}· total <span className="font-bold tabular-nums text-emerald-600">{money0(breakup.total)}</span>
            </>
          )}
        </p>
        <div className="ml-auto flex w-full flex-wrap justify-end gap-2 sm:w-auto">
          {editingCode && (
            <Button type="button" variant="outline" onClick={resetForNew} className="flex-1 sm:flex-none">
              <RotateCcw /> Cancel edit
            </Button>
          )}
          <Button onClick={onSave} disabled={saveMut.isPending || !can('note:create')} title={`${editingCode ? 'Update' : 'Save'} ${noteLabel} (Ctrl+S)`} className="flex-[2] sm:flex-none">
            {saveMut.isPending ? <Loader2 className="animate-spin" /> : <Check />} {editingCode ? `Update ${noteLabel}` : `Save ${noteLabel}`}
            <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold sm:inline">Ctrl+S</kbd>
          </Button>
        </div>
      </div>

      <NoteDirectoryDialog open={dirOpen} onOpenChange={setDirOpen} mode={mode} onEdit={loadForEdit} onDelete={del} canDelete={can('note:delete')} canPrint={can('note:print')} confirm={confirm} />
    </div>
  );
}

/** A single field inside the 2×2 document-info panel — same shape as Create Challan's. */
function MetaCell({ label, children, icon: Icon }: { label: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-card flex min-w-0 flex-col justify-center gap-1 px-3 py-2.5">
      <div className="text-muted-foreground flex items-center gap-1 text-[10px] font-bold tracking-widest uppercase">
        {Icon && <Icon className="size-3 opacity-70" />} {label}
      </div>
      <div className="text-[13px] leading-tight font-semibold">{children}</div>
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
