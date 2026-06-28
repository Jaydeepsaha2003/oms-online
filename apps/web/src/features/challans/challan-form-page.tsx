import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Lock, LockOpen, Plus, Printer, ScrollText, Trash2, UserSearch } from 'lucide-react';
import { toast } from 'sonner';
import {
  CHALLAN_STATUSES,
  computeChallanTotals,
  type ChallanDraftItem,
  type CreateChallanInput,
  type PendingChallanLine,
} from '@oms/shared';
import { cn } from '@/lib/utils';
import { openPdf } from '@/lib/pdf';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChallanDraft, useChallanEdit, useCreateChallan, usePendingChallanCustomers, useUpdateChallan } from './use-challans';

type NavState = { customerName?: string; lines?: PendingChallanLine[] };
type Row = ChallanDraftItem & { key: string };

const inr = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const numOr = (s: string) => {
  const v = parseFloat((s ?? '').replace(/,/g, ''));
  return Number.isFinite(v) ? v : 0;
};
const isKgs = (unit: string | null) => ['KGS', 'KG', 'KGS.'].includes((unit ?? '').trim().toUpperCase());
const round5 = (x: number) => Math.round(x / 5) * 5;
const round2 = (x: number) => Math.round(x * 100) / 100;
const n = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);
const itemLabel = (it: ChallanDraftItem) =>
  `${it.productName || '(item)'} · ${it.design || 'NA'} · ${isKgs(it.unit) ? `${n(it.kgs)}kg` : `${n(it.pcs)}pc`} @ ₹${n(it.price)}  #${it.dispatchId}`;

export function ChallanFormPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const isEdit = editId != null;

  const { state } = useLocation() as { state: NavState | null };
  const navCustomer = state?.customerName ?? '';
  const navIds = useMemo(() => new Set((state?.lines ?? []).map((l) => l.dispatchId)), [state]);

  const [customer, setCustomer] = useState(navCustomer);
  const { data: customers = [], isLoading: custLoading } = usePendingChallanCustomers('');
  const createDraftQ = useChallanDraft(!isEdit && customer ? { customerName: customer } : null);
  const editQ = useChallanEdit(isEdit ? editId : null);

  const createChallan = useCreateChallan();
  const updateChallan = useUpdateChallan();
  const saving = createChallan.isPending || updateChallan.isPending;

  const draft = isEdit ? editQ.data?.draft : createDraftQ.data;
  const savedChallan = editQ.data?.challan;
  const isLoading = isEdit ? editQ.isLoading : !!customer && createDraftQ.isLoading;
  const isError = isEdit ? editQ.isError : createDraftQ.isError;

  // Working state.
  const [rows, setRows] = useState<Row[]>([]);
  const [addSel, setAddSel] = useState('');
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>('CONFIRMED');
  const [freight, setFreight] = useState('0');
  const [packing, setPacking] = useState('0');
  const [pouch, setPouch] = useState('0');
  const [billingRate, setBillingRate] = useState('0');
  const [gstPct, setGstPct] = useState('0');
  const [noBill, setNoBill] = useState(false);
  const [noBillRemoveGst, setNoBillRemoveGst] = useState(false);
  const [manualTax, setManualTax] = useState(''); // '' = auto
  const [manualB, setManualB] = useState(''); // '' = auto
  const [remarks, setRemarks] = useState('');
  const [locked, setLocked] = useState({ freight: true, packing: true, pouch: true });
  // Manual line entry.
  const [showManual, setShowManual] = useState(false);
  const [m, setM] = useState({ product: '', design: 'NA', unit: 'KGS', qty: '', price: '' });
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedCode, setSavedCode] = useState('');

  const recalc = (rs: Row[], d = draft) => {
    if (!d) return;
    setFreight(String(round5(rs.reduce((a, r) => a + n(r.bags) * n(r.freightRate), 0))));
    setPacking(String(round5(rs.reduce((a, r) => a + n(r.bags) * n(r.packingRate), 0))));
    setPouch(String(round2(rs.reduce((a, r) => a + n(r.box), 0) * n(d.boxRate))));
    setGstPct(String(Math.max(0, ...rs.map((r) => n(r.gstRate)), 0)));
  };

  // One-time init when the data arrives.
  const initedRef = useRef('');
  useEffect(() => {
    if (!draft) return;
    const key = isEdit ? `edit:${editId}` : `create:${draft.customerName}`;
    if (initedRef.current === key) return;
    initedRef.current = key;

    if (isEdit && savedChallan && editQ.data) {
      const c = savedChallan;
      setRows(editQ.data.rows.map((it, i) => ({ ...it, key: `${it.dispatchId ?? 'm'}-${i}` })));
      setInvDate((c.invDate ?? new Date().toISOString()).slice(0, 10));
      setStatus(c.challanStatus);
      setFreight(String(c.freight ?? 0));
      setPacking(String(c.packing ?? 0));
      setPouch(String(c.pouch ?? 0));
      setBillingRate(String(c.billingRate ?? 0));
      setGstPct(String(c.gst ?? 0));
      setNoBill(!!c.noBill);
      setNoBillRemoveGst(!!c.noBill && n(c.tax) === 0);
      setRemarks(c.remarks ?? '');
      if (draft.isScrap) setM((x) => ({ ...x, product: 'S.S. SCRAP', unit: 'KGS' }));
    } else if (!isEdit) {
      const preset = customer === navCustomer && navIds.size ? draft.items.filter((i) => i.dispatchId != null && navIds.has(i.dispatchId)) : [];
      const next = preset.map((it, i) => ({ ...it, key: `${it.dispatchId ?? 'm'}-${i}` }));
      setRows(next);
      setBillingRate(String(draft.billingRate ?? 0));
      recalc(next, draft);
      if (draft.isScrap) setM((x) => ({ ...x, product: 'S.S. SCRAP', unit: 'KGS' }));
    }
  }, [draft, savedChallan, editQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const pool = draft?.items ?? [];
  const available = useMemo(() => pool.filter((p) => !rows.some((r) => r.dispatchId != null && r.dispatchId === p.dispatchId)), [pool, rows]);
  const optionMap = useMemo(() => new Map(available.map((it) => [itemLabel(it), it])), [available]);
  const options = useMemo(() => [...optionMap.keys()], [optionMap]);

  const addItem = () => {
    const it = optionMap.get(addSel);
    if (!it) return;
    const next = [...rows, { ...it, key: `${it.dispatchId ?? 'm'}-${rows.length}-${performance.now() | 0}` }];
    setRows(next);
    recalc(next);
    setAddSel('');
  };
  const addManual = () => {
    if (!draft) return;
    const qty = numOr(m.qty);
    const price = numOr(m.price);
    if (!m.product.trim() || qty <= 0) return toast.error('Enter a product name and quantity.');
    const unit = m.unit === 'PCS' ? 'PCS' : 'KGS';
    const row: Row = {
      key: `man-${rows.length}-${performance.now() | 0}`,
      dispatchId: null,
      orderId: null,
      orderCode: null,
      productName: m.product.trim(),
      design: m.design.trim() || 'NA',
      bags: 0,
      pcs: unit === 'PCS' ? qty : 0,
      kgs: unit === 'KGS' ? qty : 0,
      box: 0,
      unit,
      price,
      amount: round2(qty * price),
      pCategory: draft.isScrap ? 'SCRAP' : null,
      comment: null,
      gstRate: draft.isScrap ? 0 : n(draft.gst),
      freightRate: 0,
      packingRate: 0,
    };
    const next = [...rows, row];
    setRows(next);
    recalc(next);
    setM({ product: draft.isScrap ? 'S.S. SCRAP' : '', design: 'NA', unit: 'KGS', qty: '', price: '' });
  };
  const setPrice = (key: string, value: string) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const price = numOr(value);
        const qty = isKgs(r.unit) ? n(r.kgs) : n(r.pcs);
        return { ...r, price, amount: round2(qty * price) };
      }),
    );
  const removeRow = (key: string) => {
    const next = rows.filter((r) => r.key !== key);
    setRows(next);
    recalc(next);
  };

  const unlock = async (field: 'freight' | 'packing' | 'pouch') => {
    if (!locked[field]) return;
    const ok = await confirm({ title: `Unlock ${field}?`, description: `Edit ${field} manually? It is auto-calculated from the grid otherwise.`, confirmText: 'Unlock' });
    if (ok) setLocked((l) => ({ ...l, [field]: false }));
  };

  const onNoBill = async (checked: boolean) => {
    if (!checked) {
      setNoBill(false);
      setNoBillRemoveGst(false);
      return;
    }
    const keepGst = await confirm({
      title: 'No Bill',
      description: 'Keep GST in the total, or bill without tax? Choose "Remove GST" to drop the tax.',
      confirmText: 'Keep GST',
      cancelText: 'Remove GST',
    });
    setNoBill(true);
    setNoBillRemoveGst(!keepGst);
  };

  const dueDate = useMemo(() => {
    const term = isEdit ? savedChallan?.paymentTerm ?? draft?.paymentTerm : draft?.paymentTerm;
    if (term == null) return null;
    const dt = new Date(invDate);
    dt.setDate(dt.getDate() + term);
    return dt;
  }, [invDate, draft, savedChallan, isEdit]);

  const totals = useMemo(
    () =>
      computeChallanTotals({
        items: rows,
        freight: numOr(freight),
        packing: numOr(packing),
        pouch: numOr(pouch),
        gstRatePct: numOr(gstPct),
        billingRate: numOr(billingRate),
        noBill,
        noBillRemoveGst,
        isScrap: draft?.isScrap ?? false,
        tdsApplicable: draft?.tdsApplicable ?? false,
        tdsPercent: draft?.tdsPercent ?? 0,
        taxOverride: manualTax.trim() === '' ? null : numOr(manualTax),
        bOverride: manualB.trim() === '' ? null : numOr(manualB),
      }),
    [rows, freight, packing, pouch, gstPct, billingRate, noBill, noBillRemoveGst, draft, manualTax, manualB],
  );

  const resetForm = () => {
    initedRef.current = '';
    setCustomer('');
    setRows([]);
    setAddSel('');
    setSavedId(null);
    setSavedCode('');
    setNoBill(false);
    setNoBillRemoveGst(false);
    setManualTax('');
    setManualB('');
    setRemarks('');
    setStatus('CONFIRMED');
  };

  const save = async () => {
    if (!draft || rows.length === 0) return toast.error('Add at least one item.');
    if (status === 'CANCELLED') {
      const ok = await confirm({
        title: 'Save as CANCELLED?',
        description: isEdit ? 'This challan will be marked CANCELLED.' : 'You are saving a NEW challan as CANCELLED.',
        confirmText: 'Save cancelled',
      });
      if (!ok) return;
    }
    const cust = isEdit ? savedChallan?.customerName ?? draft.customerName : draft.customerName;
    const payload: CreateChallanInput = {
      code: isEdit ? savedChallan?.code : draft.code,
      prefix: draft.prefix,
      invDate: new Date(invDate).toISOString(),
      customerId: draft.customerId,
      customerName: cust,
      billingAddress: isEdit ? savedChallan?.billingAddress ?? draft.billingAddress : draft.billingAddress,
      category: isEdit ? savedChallan?.category ?? draft.category : draft.category,
      paymentTerm: isEdit ? savedChallan?.paymentTerm ?? draft.paymentTerm : draft.paymentTerm,
      dueDate: dueDate ? dueDate.toISOString() : null,
      transName: isEdit ? savedChallan?.transName ?? draft.transName : draft.transName,
      packing: numOr(packing),
      freight: numOr(freight),
      pouch: numOr(pouch),
      tcs: totals.tcs,
      tds: totals.tdsAmount,
      tdsPercent: draft.tdsPercent,
      tax: totals.tax,
      total: totals.total,
      b: totals.b,
      c: totals.c,
      remarks: remarks.trim() || null,
      gst: totals.gstRatePct,
      billingRate: numOr(billingRate),
      noBill,
      challanStatus: status as CreateChallanInput['challanStatus'],
      items: rows.map((r) => ({
        dispatchId: r.dispatchId,
        productName: r.productName,
        design: r.design,
        bags: r.bags,
        pcs: r.pcs,
        kgs: r.kgs,
        box: r.box,
        unit: r.unit,
        price: r.price,
        amount: r.amount,
        pCategory: r.pCategory,
        comment: r.comment,
      })),
    };
    const onSuccess = (c: { id: number; code: string }) => {
      setSavedId(c.id);
      setSavedCode(c.code);
      toast.success(`Challan ${c.code} ${isEdit ? 'updated' : 'saved'}`);
    };
    const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to save challan');
    if (isEdit) updateChallan.mutate({ id: editId!, ...payload }, { onSuccess, onError });
    else createChallan.mutate(payload, { onSuccess, onError });
  };

  // ── Success ──
  if (savedId) {
    return (
      <div className="space-y-4">
        <div className="bg-card mx-auto max-w-lg rounded-md border p-8 text-center shadow-sm">
          <div className="bg-emerald-100 mx-auto flex size-12 items-center justify-center rounded-full text-emerald-700">
            <Check className="size-6" />
          </div>
          <h2 className="mt-3 text-xl font-semibold">Challan {savedCode} {isEdit ? 'updated' : 'saved'}</h2>
          <p className="text-muted-foreground mt-1 text-sm">Total {inr(totals.total)}{totals.tdsAmount ? ` · Net after TDS ${inr(totals.netReceivable)}` : ''}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => openPdf(`/challans/${savedId}/challan.pdf`)}>
              <Printer /> Print / PDF
            </Button>
            <Button variant="outline" onClick={() => navigate('/challans')}>
              View Challans
            </Button>
            {!isEdit && (
              <Button variant="outline" onClick={resetForm}>
                New Challan
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const halfBill = numOr(billingRate) > 0 && !noBill;
  const title = isEdit ? `Edit Challan${savedChallan ? ` — ${savedChallan.customerName}` : ''}` : `Create Challan${draft ? ` — ${draft.customerName}` : ''}`;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <ScrollText className="size-5" />
        </div>
        <div className="mr-auto">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground text-sm">
            {draft ? (
              <>
                Invoice <span className="font-mono">{isEdit ? savedChallan?.code : draft.code}</span>
                {draft.tdsApplicable ? <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 ring-inset">TDS {draft.tdsPercent ?? 0}%</span> : null}
                {draft.isScrap ? <span className="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-purple-200 ring-inset">SCRAP · 1% TCS</span> : null}
              </>
            ) : isEdit ? (
              'Loading…'
            ) : (
              'Select a customer, then add items one by one from the dropdown'
            )}
          </p>
        </div>
        {draft && (
          <Button onClick={save} disabled={saving || rows.length === 0}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />} {isEdit ? 'Update' : 'Save'} Challan
          </Button>
        )}
      </div>

      {/* Customer + header */}
      <div className="bg-card grid gap-3 rounded-md border p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs flex items-center gap-1"><UserSearch className="size-3.5" /> Customer</Label>
          {isEdit ? (
            <Input value={savedChallan?.customerName ?? ''} readOnly className="bg-muted/40" />
          ) : (
            <NativeSelect value={customer} onChange={setCustomer} options={customers} placeholder={custLoading ? 'Loading…' : 'Select a customer…'} />
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Invoice Date</Label>
          <Input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <NativeSelect value={status} onChange={setStatus} options={[...CHALLAN_STATUSES]} />
        </div>
        {draft && (
          <>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Billing Address</Label>
              <Input value={(isEdit ? savedChallan?.billingAddress : draft.billingAddress) ?? ''} readOnly className="bg-muted/40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Due Date</Label>
              <Input value={dueDate ? dueDate.toLocaleDateString('en-GB') : '—'} readOnly className="bg-muted/40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Transporter</Label>
              <Input value={(isEdit ? savedChallan?.transName : draft.transName) ?? '—'} readOnly className="bg-muted/40" />
            </div>
          </>
        )}
      </div>

      {!isEdit && !customer && (
        <div className="bg-card text-muted-foreground flex h-40 items-center justify-center rounded-md border text-sm">Choose a customer to begin.</div>
      )}
      {isLoading && (
        <div className="text-muted-foreground flex items-center gap-2 p-6"><Loader2 className="size-4 animate-spin" /> Loading…</div>
      )}
      {isError && <p className="text-destructive">Could not load the challan.</p>}

      {draft && (
        <>
          {/* Add item */}
          <div className="bg-card space-y-3 rounded-md border p-3 shadow-sm">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label className="text-xs">Add product (dispatched &amp; not yet challaned)</Label>
                <NativeSelect value={addSel} onChange={setAddSel} options={options} placeholder={options.length ? 'Select a product…' : 'No more dispatched items'} />
              </div>
              <Button onClick={addItem} disabled={!addSel}><Plus /> Add</Button>
              <Button variant="outline" onClick={() => setShowManual((v) => !v)}>{showManual ? 'Hide manual' : 'Manual line'}</Button>
            </div>
            {showManual && (
              <div className="grid items-end gap-2 border-t pt-3 sm:grid-cols-6">
                <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Product</Label><Input value={m.product} onChange={(e) => setM({ ...m, product: e.target.value })} placeholder="e.g. S.S. SCRAP" /></div>
                <div className="space-y-1"><Label className="text-xs">Design</Label><Input value={m.design} onChange={(e) => setM({ ...m, design: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Unit</Label><NativeSelect value={m.unit} onChange={(v) => setM({ ...m, unit: v })} options={['KGS', 'PCS']} /></div>
                <div className="space-y-1"><Label className="text-xs">Qty</Label><Input value={m.qty} onChange={(e) => setM({ ...m, qty: e.target.value })} className="text-right tabular-nums" /></div>
                <div className="space-y-1"><Label className="text-xs">Price</Label><Input value={m.price} onChange={(e) => setM({ ...m, price: e.target.value })} className="text-right tabular-nums" /></div>
                <div className="sm:col-span-6"><Button size="sm" variant="secondary" onClick={addManual}><Plus /> Add manual line</Button></div>
              </div>
            )}
          </div>

          {/* Items grid */}
          <div className="bg-card overflow-x-auto rounded-md border shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
                  <th>Product</th><th>Design</th><th className="text-right">Bags</th><th className="text-right">Pcs</th><th className="text-right">Kgs</th><th className="text-right">Box</th><th>Unit</th><th className="text-right">Price</th><th className="text-right">Amount</th><th className="text-right">GST%</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-1.5">
                    <td className="font-medium">{r.productName || '—'}{r.dispatchId == null && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-600">manual</span>}</td>
                    <td>{r.design || '—'}</td>
                    <td className="text-right tabular-nums">{r.bags ?? '—'}</td>
                    <td className="text-right tabular-nums">{r.pcs ?? '—'}</td>
                    <td className="text-right tabular-nums">{r.kgs ?? '—'}</td>
                    <td className="text-right tabular-nums">{r.box ?? '—'}</td>
                    <td>{r.unit || '—'}</td>
                    <td className="text-right"><Input className="h-8 w-24 text-right tabular-nums" value={r.price ?? 0} onChange={(e) => setPrice(r.key, e.target.value)} /></td>
                    <td className="text-right font-semibold tabular-nums">{(r.amount ?? 0).toLocaleString('en-IN')}</td>
                    <td className="text-right tabular-nums">{r.gstRate || 0}</td>
                    <td className="text-right"><button onClick={() => removeRow(r.key)} className="text-muted-foreground hover:text-destructive" title="Remove line"><Trash2 className="size-4" /></button></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={11} className="text-muted-foreground px-3 py-8 text-center">No items yet — add products from the dropdown above.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Charges + Totals */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-card space-y-3 rounded-md border p-4 shadow-sm">
              <h3 className="font-semibold">Charges &amp; billing</h3>
              <div className="grid grid-cols-2 gap-3">
                <LockField label="Freight" value={freight} locked={locked.freight} onUnlock={() => unlock('freight')} onChange={setFreight} onBlur={() => setLocked((l) => ({ ...l, freight: true }))} />
                <LockField label="Packing" value={packing} locked={locked.packing} onUnlock={() => unlock('packing')} onChange={setPacking} onBlur={() => setLocked((l) => ({ ...l, packing: true }))} />
                <LockField label="Box / Pouch" value={pouch} locked={locked.pouch} onUnlock={() => unlock('pouch')} onChange={setPouch} onBlur={() => setLocked((l) => ({ ...l, pouch: true }))} />
                <div className="space-y-1"><Label className="text-xs">GST %</Label><Input value={gstPct} onChange={(e) => setGstPct(e.target.value)} className="text-right tabular-nums" /></div>
                <div className="space-y-1"><Label className="text-xs">{`Billing Rate ${halfBill ? '(half-bill)' : ''}`}</Label><Input value={billingRate} onChange={(e) => setBillingRate(e.target.value)} className="text-right tabular-nums" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Tax override</Label><Input value={manualTax} onChange={(e) => setManualTax(e.target.value)} placeholder={`auto ${Math.round(totals.tax)}`} className="text-right tabular-nums" /></div>
                <div className="space-y-1"><Label className="text-xs">B override</Label><Input value={manualB} onChange={(e) => setManualB(e.target.value)} placeholder={`auto ${Math.round(totals.b)}`} className="text-right tabular-nums" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={noBill} onChange={(e) => onNoBill(e.target.checked)} /> No Bill {noBill && <span className="text-muted-foreground text-xs">({noBillRemoveGst ? 'GST removed' : 'GST kept'})</span>}
              </label>
              <div className="space-y-1">
                <Label className="text-xs">Remarks</Label>
                <textarea className="border-input bg-background min-h-16 w-full rounded-md border px-3 py-2 text-sm" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </div>

            <div className="bg-card space-y-1.5 rounded-md border p-4 shadow-sm">
              <h3 className="mb-2 font-semibold">Totals</h3>
              <Row2 label="Taxable Amount" value={inr(totals.tAmt)} />
              <Row2 label="Freight" value={inr(numOr(freight))} />
              <Row2 label="Packing" value={inr(numOr(packing))} />
              <Row2 label="Box / Pouch" value={inr(numOr(pouch))} />
              <Row2 label={`GST${totals.gstRatePct ? ` @ ${totals.gstRatePct}%` : ''}${manualTax.trim() ? ' (manual)' : ''}`} value={inr(totals.tax)} />
              {(draft.isScrap || totals.tcs > 0) && <Row2 label="TCS @ 1%" value={inr(totals.tcs)} />}
              <div className="my-1 border-t" />
              <Row2 label="TOTAL" value={inr(totals.total)} strong />
              {draft.tdsApplicable && (
                <>
                  <Row2 label={`Less: TDS @ ${draft.tdsPercent ?? 0}%`} value={`- ${inr(totals.tdsAmount)}`} className="text-amber-700" />
                  <Row2 label="Net Receivable" value={inr(totals.netReceivable)} strong className="text-emerald-700" />
                </>
              )}
              {(halfBill || manualB.trim()) && (
                <>
                  <div className="my-1 border-t" />
                  <Row2 label={`Billed (B)${manualB.trim() ? ' (manual)' : ''}`} value={inr(totals.b)} />
                  <Row2 label="Balance (C)" value={inr(totals.c)} />
                </>
              )}
            </div>
          </div>
        </>
      )}

      <Button variant="outline" size="sm" onClick={() => navigate(isEdit ? '/challans' : '/challans/pending')}>
        <ArrowLeft /> {isEdit ? 'Challans' : 'Pending Challan'}
      </Button>
    </div>
  );
}

function LockField({ label, value, locked, onUnlock, onChange, onBlur }: { label: string; value: string; locked: boolean; onUnlock: () => void; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs flex items-center gap-1">
        {label}
        {locked ? <Lock className="size-3 text-muted-foreground" /> : <LockOpen className="size-3 text-emerald-600" />}
      </Label>
      <Input
        value={value}
        readOnly={locked}
        title={locked ? 'Double-click to unlock' : ''}
        onDoubleClick={onUnlock}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn('text-right tabular-nums', locked && 'bg-muted/40 cursor-default')}
      />
    </div>
  );
}

function Row2({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between text-sm', strong && 'text-base font-semibold', className)}>
      <span className={cn('text-muted-foreground', strong && 'text-foreground')}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export default ChallanFormPage;
