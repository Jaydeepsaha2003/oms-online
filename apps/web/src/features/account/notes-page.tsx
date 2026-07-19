import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Loader2, NotebookPen, Plus, Printer, Trash2, X } from 'lucide-react';
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
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Combobox } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { openPdf } from '@/lib/pdf';
import { useCustomers } from '@/features/customers/use-customers';
import { fetchNote, useDeleteNote, useNextNoteNo, useNoteDirectory, useRecentSold, useSaveNote } from './use-notes';

const money = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const prettyDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const numOrU = (s: string) => (s.trim() === '' ? undefined : Number(s));

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
    { id: 'ref', label: 'Ref Inv', cell: (l) => <span className="font-mono text-xs">{l.refInvNo ?? '—'}</span> },
    { id: 'product', label: 'Product', cell: (l) => <span className="font-medium">{l.productName}</span> },
    { id: 'design', label: 'Design', cell: (l) => l.design ?? '—' },
    { id: 'bags', label: 'Bags', align: 'right', cell: (l) => l.bags ?? '—' },
    { id: 'pcs', label: 'Pcs', align: 'right', cell: (l) => l.pcs ?? '—' },
    { id: 'kgs', label: 'Kgs', align: 'right', cell: (l) => l.kgs ?? '—' },
    { id: 'box', label: 'Box', align: 'right', cell: (l) => l.box ?? '—' },
    { id: 'unit', label: 'Unit', cell: (l) => l.unit ?? '—' },
    { id: 'price', label: 'Price', align: 'right', cell: (l) => <span className="tabular-nums">{money(l.price ?? 0)}</span> },
    { id: 'amount', label: 'Amount', align: 'right', cell: (l) => <span className="tabular-nums font-semibold">{money(noteItemAmount(l))}</span> },
    { id: 'gst', label: 'GST %', align: 'right', cell: (l) => `${l.gstRate ?? 0}` },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <NotebookPen className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Debit / Credit Note</h2>
          <p className="text-muted-foreground text-sm">
            Debit note increases what a party owes (squares off advances); credit note reduces it (clears opening → invoices → parks the rest).
          </p>
        </div>
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

      {/* Party + meta */}
      <div className="bg-card grid grid-cols-1 gap-3 rounded-md border p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-sm">Voucher No</Label>
          <Input value={voucherNo} readOnly className="font-mono font-semibold" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Date</Label>
          <Input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-sm">Party Name *</Label>
          <NativeSelect value={party} onChange={onPartyChange} options={partyOptions} placeholder="Select party…" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Category</Label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Transport</Label>
          <Input value={transName} onChange={(e) => setTransName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Payment Term (days)</Label>
          <Input value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} inputMode="numeric" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Billing Rate (₹/kg)</Label>
          <Input value={billingRate} onChange={(e) => setBillingRate(e.target.value)} inputMode="decimal" placeholder="0 = full bill" />
        </div>
      </div>

      {/* Item entry */}
      <div className="bg-card space-y-3 rounded-md border p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <div className="col-span-2 space-y-1 lg:col-span-2">
            <Label className="text-sm">Product (from last 12 months' sales)</Label>
            <Combobox
              value=""
              onChange={pickRecent}
              options={recentSold.map((r: RecentSoldRow, i) => ({ value: String(i), label: `${r.invNo} · ${r.productName}${r.design ? ` · ${r.design}` : ''} · ${money(r.price)}` }))}
              placeholder={customerId ? 'Search a past sale…' : 'Select a party first'}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Product Name</Label>
            <Input value={entry.product} onChange={(e) => setEntry((s) => ({ ...s, product: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Design</Label>
            <Input value={entry.design} onChange={(e) => setEntry((s) => ({ ...s, design: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Unit</Label>
            <Input value={entry.unit} onChange={(e) => setEntry((s) => ({ ...s, unit: e.target.value }))} placeholder="KGS / PCS / BAG / BOX" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Ref Inv No</Label>
            <Input value={entry.refInvNo} onChange={(e) => setEntry((s) => ({ ...s, refInvNo: e.target.value }))} className="font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Bags</Label>
            <Input value={entry.bags} onChange={(e) => setEntry((s) => ({ ...s, bags: e.target.value }))} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Pcs</Label>
            <Input value={entry.pcs} onChange={(e) => setEntry((s) => ({ ...s, pcs: e.target.value }))} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Kgs</Label>
            <Input value={entry.kgs} onChange={(e) => setEntry((s) => ({ ...s, kgs: e.target.value }))} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Box</Label>
            <Input value={entry.box} onChange={(e) => setEntry((s) => ({ ...s, box: e.target.value }))} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Price</Label>
            <Input value={entry.price} onChange={(e) => setEntry((s) => ({ ...s, price: e.target.value }))} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Amount</Label>
            <Input value={money(entryAmount)} readOnly className="tabular-nums" />
          </div>
          <div className="col-span-2 space-y-1 lg:col-span-1">
            <Label className="text-sm">Comment</Label>
            <Input value={entry.comment} onChange={(e) => setEntry((s) => ({ ...s, comment: e.target.value }))} />
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={addLine} className="w-full">
              <Plus /> Add
            </Button>
          </div>
        </div>
      </div>

      {/* Item grid */}
      <DataTable
        columns={lineCols}
        rows={lines}
        rowKey={(l) => String(lines.indexOf(l))}
        emptyText="No items yet — pick a product above and click Add."
        actions={(l) => {
          const i = lines.indexOf(l);
          return (
            <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => removeLine(i)} aria-label="Remove">
              <Trash2 className="size-4" />
            </Button>
          );
        }}
      />

      {/* Charges + breakup */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="bg-card space-y-3 rounded-md border p-3 shadow-sm lg:col-span-2">
          <p className="text-sm font-semibold">Charges</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-sm">Packing</Label>
              <Input value={packing} onChange={(e) => setPacking(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Freight</Label>
              <Input value={freight} onChange={(e) => setFreight(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Pouch</Label>
              <Input value={pouch} onChange={(e) => setPouch(e.target.value)} inputMode="decimal" />
            </div>
            {mode === 'DEBIT' && (
              <div className="space-y-1">
                <Label className="text-sm">TCS</Label>
                <Input value={tcs} onChange={(e) => setTcs(e.target.value)} inputMode="decimal" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={noBill} onCheckedChange={(v) => { setNoBill(v); if (!v) setNoBillWithoutGst(false); }} />
              No Bill (all on cash)
            </label>
            {noBill && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={noBillWithoutGst} onCheckedChange={setNoBillWithoutGst} />
                Without GST
              </label>
            )}
            <div className="flex-1" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Remarks</Label>
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        {/* Breakup */}
        <div className="bg-card space-y-2 rounded-md border p-4 shadow-sm">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Items total</span><span className="tabular-nums">{money(breakup.tAmt)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">GST %</span><span className="tabular-nums">{breakup.gstPercent}%</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{money(breakup.tax)}</span></div>
          <div className="my-1 border-t" />
          <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{money0(breakup.total)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">B (bank)</span><span className="tabular-nums font-semibold text-blue-600">{money0(breakup.b)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">C (cash)</span><span className="tabular-nums font-semibold text-emerald-600">{money0(breakup.c)}</span></div>
          <Button className="mt-2 w-full" onClick={onSave} disabled={saveMut.isPending || !can('note:create')}>
            {saveMut.isPending ? <Loader2 className="animate-spin" /> : null}
            {editingCode ? `Update ${noteLabel}` : `Save ${noteLabel}`}
          </Button>
          {editingCode && (
            <Button variant="ghost" className="w-full" onClick={resetForNew}>
              <X /> Cancel edit — start new
            </Button>
          )}
        </div>
      </div>

      <NoteDirectoryDialog open={dirOpen} onOpenChange={setDirOpen} mode={mode} onEdit={loadForEdit} onDelete={del} canDelete={can('note:delete')} canPrint={can('note:print')} confirm={confirm} />
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
    { id: 'code', label: 'No', cell: (r) => <span className="font-mono font-semibold">{r.code}</span> },
    { id: 'date', label: 'Date', cell: (r) => prettyDate(r.invDate) },
    { id: 'party', label: 'Customer', cell: (r) => r.customerName },
    { id: 'b', label: 'B (bank)', align: 'right', cell: (r) => <span className="tabular-nums">{money0(r.b)}</span> },
    { id: 'c', label: 'C (cash)', align: 'right', cell: (r) => <span className="tabular-nums">{money0(r.c)}</span> },
    { id: 'total', label: 'Total', align: 'right', cell: (r) => <span className="tabular-nums font-semibold">{money0(r.total)}</span> },
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
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="w-40 space-y-1">
            <Label className="text-sm">Pay Mode</Label>
            <NativeSelect value={payMode} onChange={setPayMode} options={['ALL', 'BANK', 'CASH', 'BOTH']} />
          </div>
          <p className="text-muted-foreground ml-auto text-sm">{rows.length} record{rows.length === 1 ? '' : 's'}</p>
        </div>
        <div className="max-h-[55vh] overflow-auto">
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(r) => r.code}
            isLoading={isLoading}
            emptyText="No notes for these filters."
            onRowClick={(r) => onEdit(r)}
            actions={(r) => (
              <div className="flex justify-end gap-1">
                {canPrint && (
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => openPdf(`/notes/${r.mode}/${encodeURIComponent(r.code)}/print.pdf`)} aria-label="Print">
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
