import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, History, Loader2, Lock, LockOpen, Plus, Printer, RotateCcw, ScrollText, Trash2, UserSearch } from 'lucide-react';
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
import { useAllChallanCustomers, useChallanDraft, useChallanEdit, useChallanNextCode, useCreateChallan, useUpdateChallan } from './use-challans';
import { clearChallanDraft, loadChallanDraft, saveChallanDraft, type ChallanDraftData } from './challan-draft';

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
  const { data: customers = [], isLoading: custLoading } = useAllChallanCustomers();
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
  const [prefix, setPrefix] = useState('');
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
  const [manualC, setManualC] = useState(''); // '' = auto
  const [remarks, setRemarks] = useState('');
  const [locked, setLocked] = useState({ freight: true, packing: true, pouch: true });
  // Manual line entry.
  const [showManual, setShowManual] = useState(false);
  const [m, setM] = useState({ product: '', design: 'NA', unit: 'KGS', qty: '', price: '' });
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedCode, setSavedCode] = useState('');

  // ── Work-in-progress local draft (Form14 TempChallanTbl): persist a half-built
  // challan across refresh/navigation and offer it back. New challan only. ──
  const draftEnabled = !isEdit;
  const draftReady = useRef(false); // gates auto-save until the initial restore settles
  const restoreRef = useRef<ChallanDraftData | null>(null); // saved rows/fields awaiting the draft fetch
  const [restoredDraft, setRestoredDraft] = useState(false);

  // Live invoice-no preview for the chosen prefix + date (server assigns the final one on save).
  const nextCodeQ = useChallanNextCode(!isEdit ? prefix || undefined : undefined, invDate, !isEdit);
  const previewCode = isEdit ? savedChallan?.code ?? '—' : nextCodeQ.data?.code ?? draft?.code ?? '—';

  const recalc = (rs: Row[], d = draft) => {
    if (!d) return;
    setFreight(String(round5(rs.reduce((a, r) => a + n(r.bags) * n(r.freightRate), 0))));
    setPacking(String(round5(rs.reduce((a, r) => a + n(r.bags) * n(r.packingRate), 0))));
    setPouch(String(round2(rs.reduce((a, r) => a + n(r.box), 0) * n(d.boxRate))));
    setGstPct(String(Math.max(0, ...rs.map((r) => n(r.gstRate)), 0)));
  };

  // Restore a saved WIP challan once on mount (new challan, not arriving from
  // Pending Challan). Setting the customer triggers the draft fetch; the init
  // effect below then applies the saved rows + edits.
  useEffect(() => {
    if (!draftEnabled) {
      draftReady.current = true;
      return;
    }
    if (navCustomer) {
      // Came from "Create Challan" on the Pending list — honour that selection.
      draftReady.current = true;
      return;
    }
    const d = loadChallanDraft();
    if (d && d.customer && Array.isArray(d.rows) && d.rows.length) {
      restoreRef.current = d;
      setRestoredDraft(true);
      setCustomer(d.customer); // fetches the pool → init effect restores the rest
    } else {
      draftReady.current = true;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // One-time init when the data arrives.
  const initedRef = useRef('');
  useEffect(() => {
    if (!draft) return;
    const key = isEdit ? `edit:${editId}` : `create:${draft.customerName}`;
    if (initedRef.current === key) return;
    initedRef.current = key;
    setPrefix(draft.prefix);

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
      const restore = restoreRef.current;
      if (restore && restore.customer === draft.customerName) {
        // Reinstate the saved WIP challan (TempChallanTbl equivalent).
        restoreRef.current = null;
        setRows((restore.rows as Row[]).map((it, i) => ({ ...it, key: `${it.dispatchId ?? 'm'}-${i}` })));
        setInvDate(restore.invDate || invDate);
        setPrefix(restore.prefix || draft.prefix);
        setStatus(restore.status || 'CONFIRMED');
        setFreight(restore.freight);
        setPacking(restore.packing);
        setPouch(restore.pouch);
        setBillingRate(restore.billingRate || String(draft.billingRate ?? 0));
        setGstPct(restore.gstPct);
        setNoBill(!!restore.noBill);
        setNoBillRemoveGst(!!restore.noBillRemoveGst);
        setManualTax(restore.manualTax || '');
        setManualB(restore.manualB || '');
        setManualC(restore.manualC || '');
        setRemarks(restore.remarks || '');
        if (draft.isScrap) setM((x) => ({ ...x, product: 'S.S. SCRAP', unit: 'KGS' }));
        draftReady.current = true;
        return;
      }
      const preset = customer === navCustomer && navIds.size ? draft.items.filter((i) => i.dispatchId != null && navIds.has(i.dispatchId)) : [];
      const next = preset.map((it, i) => ({ ...it, key: `${it.dispatchId ?? 'm'}-${i}` }));
      setRows(next);
      setBillingRate(String(draft.billingRate ?? 0));
      recalc(next, draft);
      if (draft.isScrap) setM((x) => ({ ...x, product: 'S.S. SCRAP', unit: 'KGS' }));
      draftReady.current = true;
    }
  }, [draft, savedChallan, editQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrap parties bill as manual lines (there's no dispatched pool), so open the
  // manual entry automatically — its design field is locked (scrap carries no design).
  useEffect(() => {
    if (draft?.isScrap) setShowManual(true);
  }, [draft?.isScrap]);

  // Auto-save the WIP challan (debounced) whenever it has content; clear when empty.
  useEffect(() => {
    if (!draftEnabled || !draftReady.current) return;
    const t = setTimeout(() => {
      if (customer && rows.length) {
        saveChallanDraft({ customer, invDate, prefix, status, freight, packing, pouch, billingRate, gstPct, noBill, noBillRemoveGst, manualTax, manualB, manualC, remarks, rows });
      } else {
        clearChallanDraft();
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftEnabled, customer, invDate, prefix, status, freight, packing, pouch, billingRate, gstPct, noBill, noBillRemoveGst, manualTax, manualB, manualC, remarks, rows]);

  // Throw away the restored draft and start blank.
  const discardDraft = () => {
    clearChallanDraft();
    setRestoredDraft(false);
    restoreRef.current = null;
    resetForm();
  };

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
        cOverride: manualC.trim() === '' ? null : numOr(manualC),
      }),
    [rows, freight, packing, pouch, gstPct, billingRate, noBill, noBillRemoveGst, draft, manualTax, manualB, manualC],
  );

  const resetForm = () => {
    initedRef.current = '';
    clearChallanDraft();
    setRestoredDraft(false);
    setCustomer('');
    setRows([]);
    setAddSel('');
    setSavedId(null);
    setSavedCode('');
    setNoBill(false);
    setNoBillRemoveGst(false);
    setManualTax('');
    setManualB('');
    setManualC('');
    setRemarks('');
    setStatus('CONFIRMED');
  };

  // Leave the form. Always drop the saved WIP draft first so it never resurfaces
  // as a "Restored your unsaved challan" prompt next time.
  const handleCancel = () => {
    clearChallanDraft();
    setRestoredDraft(false);
    restoreRef.current = null;
    navigate(isEdit ? '/challans' : '/challans/pending');
  };

  // Reset button: clear back to blank (new) or reload the saved challan (edit),
  // after a confirm when there's anything to lose.
  const handleReset = async () => {
    const hasContent = customer.trim() || rows.length > 0;
    if (hasContent) {
      const ok = await confirm({
        title: isEdit ? 'Revert changes to this challan?' : 'Reset this challan?',
        description: isEdit
          ? 'Every line and field goes back to the last saved challan.'
          : 'Clears the customer and all items so you can start fresh.',
        confirmText: isEdit ? 'Revert' : 'Reset',
        destructive: true,
      });
      if (!ok) return;
    }
    if (isEdit) {
      initedRef.current = ''; // re-run the load effect against the saved challan
    } else {
      resetForm();
    }
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
      prefix: prefix || draft.prefix,
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
      clearChallanDraft(); // the WIP is now persisted server-side
      setRestoredDraft(false);
      setSavedId(c.id);
      setSavedCode(c.code);
      toast.success(`Challan ${c.code} ${isEdit ? 'updated' : 'saved'}`);
    };
    const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to save challan');
    if (isEdit) updateChallan.mutate({ id: editId!, ...payload }, { onSuccess, onError });
    else createChallan.mutate(payload, { onSuccess, onError });
  };

  // Ctrl/Cmd+S saves the challan; Esc cancels (bound once; always call the
  // latest closures via refs).
  const saveRef = useRef(save);
  saveRef.current = save;
  const cancelRef = useRef(handleCancel);
  cancelRef.current = handleCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      } else if (e.key === 'Escape') {
        // Let an open dropdown / dialog swallow Esc first; only cancel when none is open.
        if (!document.querySelector('[data-slot="popover-content"], [role="dialog"], [role="alertdialog"]')) {
          cancelRef.current();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  return (
    // Fill the available viewport so ONLY the item list scrolls internally — the
    // bill-to header, charges and totals (and the page header/action bar) stay put
    // instead of the whole page scrolling under the sticky header (which overlapped).
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      {/* Header — pick / show the customer here; Save / Cancel / Reset sit at the
          bottom of the form (sticky). */}
      <div className="bg-background/85 z-20 -mt-1 flex shrink-0 items-center gap-2 rounded-md py-1 backdrop-blur">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(isEdit ? '/challans' : '/challans/pending')} title="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="bg-gradient-brand flex size-8 items-center justify-center rounded-md text-white shadow-sm ring-1 ring-white/20">
          <ScrollText className="size-4" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-muted-foreground shrink-0 text-sm font-semibold whitespace-nowrap">
            {isEdit ? 'Edit Challan' : 'Create Challan'} <span className="text-muted-foreground/60">—</span>
          </span>
          {isEdit ? (
            <span className="truncate text-base font-bold tracking-tight">{savedChallan?.customerName ?? ''}</span>
          ) : (
            <div className="min-w-0 max-w-md flex-1">
              <NativeSelect
                value={customer}
                onChange={setCustomer}
                options={customers}
                placeholder={custLoading ? 'Loading…' : 'Select a customer…'}
                className="bg-background h-9 w-full rounded-md text-base font-semibold"
              />
            </div>
          )}
        </div>
      </div>

      {/* Restored work-in-progress notice */}
      {restoredDraft && (
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <History className="size-4 shrink-0" /> Restored your unsaved challan from last time — keep editing or discard it.
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-amber-800 hover:bg-amber-100 hover:text-amber-900" onClick={discardDraft}>
            Discard
          </Button>
        </div>
      )}

      {/* Invoice paper — flexes to fill the remaining height; its item list is the
          only part that scrolls (header / charges / totals stay pinned). */}
      <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border shadow-sm">
        {/* Header: Bill-to + invoice meta (compact colourful banner) */}
        <div className="from-primary/[0.08] shrink-0 border-b bg-gradient-to-r via-sky-50/50 to-transparent px-4 py-2.5">
          <div className="grid items-start gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-6">
            {/* Bill To — spans two columns; the four meta fields align in the same row */}
            <div className="min-w-[240px] space-y-1 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-primary/70 flex items-center gap-1.5 text-sm font-semibold tracking-wide uppercase">
                  <UserSearch className="size-4" /> Bill To
                </span>
                {draft?.category && <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">{draft.category}</span>}
                {draft?.tdsApplicable && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">TDS {draft.tdsPercent ?? 0}%</span>}
                {draft?.isScrap && <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">SCRAP · 1% TCS</span>}
              </div>
              {/* Customer is chosen in the top header now — shown here read-only so
                  the invoice still reads its bill-to. */}
              {draft && <div className="text-xl font-bold tracking-tight">{isEdit ? savedChallan?.customerName : draft.customerName}</div>}
              {draft && <p className="text-muted-foreground max-w-md truncate text-sm">{(isEdit ? savedChallan?.billingAddress : draft.billingAddress) || '—'}</p>}
            </div>

            <MetaCell label="Invoice No">
              <div className="flex items-center gap-1.5">
                {!isEdit && (draft?.prefixes.length ?? 0) > 1 && (
                  <select
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    className="border-input bg-background h-8 rounded border px-1.5 text-sm font-semibold"
                    title="Challan prefix"
                  >
                    {draft?.prefixes.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-primary font-mono text-base font-bold">{previewCode}</span>
              </div>
            </MetaCell>
            <MetaCell label="Invoice Date"><Input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} className="bg-background h-8 w-full max-w-[9.75rem] text-sm" /></MetaCell>
            <MetaCell label="Due Date"><span className="text-base tabular-nums">{dueDate ? dueDate.toLocaleDateString('en-GB') : '—'}</span></MetaCell>
            <MetaCell label="Status">
              {isEdit ? (
                <NativeSelect value={status} onChange={setStatus} options={[...CHALLAN_STATUSES]} className="bg-background h-8 w-full max-w-[9rem]" />
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded bg-emerald-100 px-2 py-0.5 text-sm font-semibold text-emerald-700">
                  <span className="size-2 rounded-full bg-emerald-500" /> CONFIRMED
                </span>
              )}
            </MetaCell>
          </div>
        </div>

        {!isEdit && !customer && (
          <div className="text-muted-foreground border-t p-8 text-center text-sm">Choose a customer to begin.</div>
        )}
        {isLoading && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 border-t p-6 text-sm"><Loader2 className="size-4 animate-spin" /> Loading…</div>
        )}
        {isError && <p className="text-destructive border-t p-4 text-sm">Could not load the challan.</p>}

        {draft && (
          <>
            {/* Add-line toolbar */}
            <div className="bg-muted/30 shrink-0 space-y-2 border-y px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <NativeSelect
                    value={addSel}
                    onChange={setAddSel}
                    options={options}
                    placeholder={options.length ? '+ Add a dispatched product…' : 'No more dispatched items'}
                    className="h-9"
                    listHeader={
                      <>
                        <span className="min-w-0 flex-1">Product</span>
                        <span className="w-24">Design</span>
                        <span className="w-20 text-right">Qty</span>
                        <span className="w-16 text-right">Price</span>
                      </>
                    }
                    renderOption={(val) => {
                      const it = optionMap.get(val);
                      if (!it) return <span className="truncate">{val}</span>;
                      return (
                        <>
                          <span className="min-w-0 flex-1 truncate font-medium">{it.productName || '(item)'}</span>
                          <span className="text-muted-foreground w-24 truncate">{it.design || 'NA'}</span>
                          <span className="w-20 text-right tabular-nums">{isKgs(it.unit) ? `${n(it.kgs)} kg` : `${n(it.pcs)} pc`}</span>
                          <span className="w-16 text-right tabular-nums">₹{n(it.price)}</span>
                        </>
                      );
                    }}
                  />
                </div>
                <Button onClick={addItem} disabled={!addSel}><Plus /> Add</Button>
                <Button variant="outline" onClick={() => setShowManual((v) => !v)}>{showManual ? 'Hide manual' : 'Manual'}</Button>
              </div>
              {showManual && (
                <div className="grid items-end gap-2 sm:grid-cols-6">
                  <div className="space-y-1 sm:col-span-2"><Label className="text-base">Product</Label><Input value={m.product} onChange={(e) => setM({ ...m, product: e.target.value })} placeholder="e.g. S.S. SCRAP" className="h-9 text-base" /></div>
                  <div className="space-y-1"><Label className="text-base">Design</Label><Input value={m.design} onChange={(e) => setM({ ...m, design: e.target.value })} disabled={draft.isScrap} title={draft.isScrap ? 'Scrap items carry no design' : undefined} className={cn('h-9 text-base', draft.isScrap && 'bg-muted/40 cursor-not-allowed')} /></div>
                  <div className="space-y-1"><Label className="text-base">Unit</Label><NativeSelect value={m.unit} onChange={(v) => setM({ ...m, unit: v })} options={['KGS', 'PCS']} className="h-9 text-base" /></div>
                  <div className="space-y-1"><Label className="text-base">Qty</Label><Input value={m.qty} onChange={(e) => setM({ ...m, qty: e.target.value })} className="h-9 text-right text-base tabular-nums" /></div>
                  <div className="space-y-1"><Label className="text-base">Price</Label><Input value={m.price} onChange={(e) => setM({ ...m, price: e.target.value })} className="h-9 text-right text-base tabular-nums" /></div>
                  <div className="sm:col-span-6"><Button size="sm" variant="secondary" onClick={addManual}><Plus /> Add manual line</Button></div>
                </div>
              )}
            </div>

            {/* Line items — fills the remaining space and scrolls internally when long */}
            <div className="min-h-[120px] flex-1 overflow-auto">
              <table className="w-full text-[15px]">
                <thead className="bg-muted sticky top-0 z-10">
                  <tr className="text-muted-foreground border-b text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-sm [&>th]:font-semibold [&>th]:tracking-wide [&>th]:uppercase">
                    <th className="w-12 text-center">#</th>
                    <th>Product</th>
                    <th className="w-28">Design</th>
                    <th className="w-20 text-right">Bags</th>
                    <th className="w-20 text-right">Pcs</th>
                    <th className="w-20 text-right">Kgs</th>
                    <th className="w-20 text-right">Box</th>
                    <th className="w-16">Unit</th>
                    <th className="w-28 text-right">Price</th>
                    <th className="w-28 text-right">Amount</th>
                    <th className="w-20 text-right">GST%</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.key} className="odd:bg-muted/20 hover:bg-primary/5 border-b transition-colors last:border-0 [&>td]:px-3 [&>td]:py-2">
                      <td className="w-12 text-center text-muted-foreground tabular-nums">{idx + 1}</td>
                      <td className="font-medium">{r.productName || '—'}{r.dispatchId == null && <span className="bg-muted text-muted-foreground ml-1 rounded px-1 text-[10px]">manual</span>}</td>
                      <td className="w-28 text-muted-foreground">{r.design || '—'}</td>
                      <td className="w-20 text-right tabular-nums">{r.bags ?? '—'}</td>
                      <td className="w-20 text-right tabular-nums">{r.pcs ?? '—'}</td>
                      <td className="w-20 text-right tabular-nums">{r.kgs ?? '—'}</td>
                      <td className="w-20 text-right tabular-nums">{r.box ?? '—'}</td>
                      <td className="w-16 text-muted-foreground">{r.unit || '—'}</td>
                      <td className="w-28 text-right tabular-nums">₹{(r.price ?? 0).toLocaleString('en-IN')}</td>
                      <td className="w-28 text-right font-semibold tabular-nums">{(r.amount ?? 0).toLocaleString('en-IN')}</td>
                      <td className="w-20 text-muted-foreground text-right tabular-nums">{r.gstRate || 0}</td>
                      <td className="w-10 text-right"><button onClick={() => removeRow(r.key)} className="text-muted-foreground hover:text-destructive" title="Remove line"><Trash2 className="size-3.5" /></button></td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-10 text-center">
                        <div className="text-muted-foreground flex flex-col items-center gap-1.5 text-sm">
                           <Plus className="size-5 opacity-40" />
                           No items yet — pick a dispatched product above, or add a manual line.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="bg-muted/60">
                    <tr className="border-t-2 font-semibold [&>td]:px-3 [&>td]:py-1.5">
                      <td className="w-12"></td>
                      <td className="text-muted-foreground text-sm tracking-wide uppercase">Total · {rows.length} item(s)</td>
                      <td className="w-28"></td>
                      <td className="w-20 text-right tabular-nums">{totals.tBags || ''}</td>
                      <td className="w-20 text-right tabular-nums">{totals.tPcs || ''}</td>
                      <td className="w-20 text-right tabular-nums">{totals.tKgs || ''}</td>
                      <td className="w-20 text-right tabular-nums">{totals.tBox || ''}</td>
                      <td className="w-16"></td>
                      <td className="w-28"></td>
                      <td className="w-28 text-primary text-right tabular-nums">{totals.tAmt.toLocaleString('en-IN')}</td>
                      <td className="w-20"></td>
                      <td className="w-10"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Footer: charges + totals */}
            <div className="grid shrink-0 gap-4 border-t p-4 lg:grid-cols-[1fr_320px]">
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
                  <div className="space-y-1 xl:col-span-1"><Label className="text-base">Transporter</Label><Input value={(isEdit ? savedChallan?.transName : draft.transName) || '—'} readOnly className="bg-muted/40 h-9 text-base" /></div>
                  <LockField label="Freight" value={freight} locked={locked.freight} onUnlock={() => unlock('freight')} onChange={setFreight} onBlur={() => setLocked((l) => ({ ...l, freight: true }))} />
                  <LockField label="Packing" value={packing} locked={locked.packing} onUnlock={() => unlock('packing')} onChange={setPacking} onBlur={() => setLocked((l) => ({ ...l, packing: true }))} />
                  <LockField label="Box / Pouch" value={pouch} locked={locked.pouch} onUnlock={() => unlock('pouch')} onChange={setPouch} onBlur={() => setLocked((l) => ({ ...l, pouch: true }))} />
                  {/* GST % field removed — GST is not editable; it follows the customer's configured
                      rate (applied automatically) and is shown in the totals panel below. */}
                  <div className="space-y-1"><Label className="text-base">{`Billing Rate${halfBill ? ' · half' : ''}`}</Label><Input value={billingRate} onChange={(e) => setBillingRate(e.target.value)} className="h-9 text-right text-base tabular-nums" /></div>
                </div>
                {/* Settlement — B Amount & C Amount, with the No Bill toggle beside B */}
                <div className="grid items-stretch gap-2.5 sm:grid-cols-[1fr_auto_1fr]">
                  <EditRow label="B AMOUNT" computed={totals.b} manual={manualB} onManual={setManualB} prominent />
                  <label
                    className={cn(
                      'flex cursor-pointer flex-col justify-center gap-1 rounded-md border px-4 py-2 transition-colors select-none',
                      noBill ? 'border-primary/50 bg-primary/5' : 'bg-card hover:bg-muted/40',
                    )}
                    title="Bill without a tax invoice"
                  >
                    <span className="text-muted-foreground flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
                      <input type="checkbox" checked={noBill} onChange={(e) => onNoBill(e.target.checked)} className="size-4 accent-blue-600" />
                      No Bill
                    </span>
                    {noBill && <span className="text-[11px] font-medium text-amber-600">{noBillRemoveGst ? 'GST removed' : 'GST kept'}</span>}
                  </label>
                  <EditRow label="C AMOUNT" computed={totals.c} manual={manualC} onManual={setManualC} prominent />
                </div>
                <textarea className="border-input bg-background min-h-12 w-full rounded-md border px-3 py-2 text-base" placeholder="Remarks…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>

              <div className="self-start overflow-hidden rounded-md border shadow-sm">
                <div className="bg-card space-y-1 p-3">
                  <Row2 label="Taxable" value={inr(totals.tAmt)} />
                  <Row2 label="Freight" value={inr(numOr(freight))} />
                  <Row2 label="Packing" value={inr(numOr(packing))} />
                  <Row2 label="Box / Pouch" value={inr(numOr(pouch))} />
                  <Row2 label={`GST${totals.gstRatePct ? ` @ ${totals.gstRatePct}%` : ''}`} value={inr(totals.tax)} />
                  {(draft.isScrap || totals.tcs > 0) && <Row2 label="TCS @ 1%" value={inr(totals.tcs)} />}
                </div>
                <div className="bg-gradient-brand flex items-center justify-between px-3 py-2.5 text-lg font-bold text-white">
                  <span>TOTAL</span>
                  <span className="tabular-nums">{inr(totals.total)}</span>
                </div>
                {draft.tdsApplicable && (
                  <div className="bg-card space-y-1 p-3">
                    <Row2 label={`Less: TDS @ ${draft.tdsPercent ?? 0}%`} value={`- ${inr(totals.tdsAmount)}`} className="text-amber-700" />
                    <div className="flex items-center justify-between rounded-md bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-700">
                      <span>Net Receivable</span>
                      <span className="tabular-nums">{inr(totals.netReceivable)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom action bar — always at the foot of the form; Cancel / Reset / Save. */}
      <div className="bg-background/95 z-30 -mx-1 mt-1 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-2 py-3 backdrop-blur">
        <p className="text-sm">
          {rows.length} item(s)
          {draft && (
            <>
              {' '}· total <span className="font-bold tabular-nums text-emerald-600">{inr(totals.total)}</span>
            </>
          )}
        </p>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button type="button" variant="destructive" onClick={handleCancel} title="Cancel (Esc)">
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={handleReset} title={isEdit ? 'Revert unsaved changes' : 'Clear the form'}>
            <RotateCcw /> Reset
          </Button>
          {draft && (
            <Button onClick={save} disabled={saving || rows.length === 0} title={`${isEdit ? 'Update' : 'Create'} challan (Ctrl+S)`}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />} {isEdit ? 'Update Challan' : 'Create Challan'}
              <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold">Ctrl+S</kbd>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">{label}</div>
      <div className="text-base leading-tight font-medium">{children}</div>
    </div>
  );
}

function LockField({ label, value, locked, onUnlock, onChange, onBlur }: { label: string; value: string; locked: boolean; onUnlock: () => void; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-base flex items-center gap-1.5">
        {label}
        {locked ? <Lock className="size-3.5 text-muted-foreground" /> : <LockOpen className="size-3.5 text-emerald-600" />}
      </Label>
      <Input
        value={value}
        readOnly={locked}
        title={locked ? 'Double-click to unlock' : ''}
        onDoubleClick={onUnlock}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn('h-9 text-right text-base tabular-nums', locked && 'bg-muted/40 cursor-default')}
      />
    </div>
  );
}

/** A totals row whose amount is directly editable (Form14 Tax/B/C). Shows the live
 *  computed value; typing overrides it; the ↺ reverts to auto. `prominent` renders
 *  it as a bigger stacked card (used for B/C at the top of the totals panel). */
function EditRow({
  label,
  computed,
  manual,
  onManual,
  prominent,
}: {
  label: string;
  computed: number;
  manual: string;
  onManual: (v: string) => void;
  prominent?: boolean;
}) {
  const isManual = manual.trim() !== '';
  if (prominent) {
    return (
      <div className="bg-card rounded-md border px-3 py-2">
        <div className="flex items-center justify-between gap-1">
          <span className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">{label}</span>
          {isManual ? (
            <button onClick={() => onManual('')} title="Reset to auto" className="text-amber-600 hover:text-amber-700" type="button">
              <RotateCcw className="size-3.5" />
            </button>
          ) : (
            <span className="w-3.5" />
          )}
        </div>
        <input
          value={isManual ? manual : String(Math.round(computed))}
          onChange={(e) => onManual(e.target.value)}
          className="border-input bg-background mt-1 h-10 w-full rounded border px-2 text-right text-xl font-bold tabular-nums focus:ring-1"
        />
        {isManual && <span className="text-[11px] font-medium text-amber-600">manual override</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 text-base">
      <span className="text-muted-foreground">
        {label}
        {isManual && <span className="ml-1 text-[11px] font-medium text-amber-600">manual</span>}
      </span>
      <div className="flex items-center gap-1">
        <input
          value={isManual ? manual : String(Math.round(computed))}
          onChange={(e) => onManual(e.target.value)}
          className="border-input bg-background h-8 w-32 rounded border px-2 text-right text-base tabular-nums focus:ring-1"
        />
        {isManual && (
          <button onClick={() => onManual('')} title="Reset to auto" className="text-muted-foreground hover:text-foreground">
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function Row2({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between text-base', strong && 'text-lg font-semibold', className)}>
      <span className={cn('text-muted-foreground', strong && 'text-foreground')}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export default ChallanFormPage;
