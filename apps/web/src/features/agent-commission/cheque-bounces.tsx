import { useMemo, useRef, useState } from 'react';
import { Camera, Landmark, Loader2, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { bounceTotal, type ChequeDto } from '@oms/shared';
import { getApiErrorMessage, uploadFile } from '@/lib/api';
import { looksLikeImage, prepareImageForUpload } from '@/lib/image-prep';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAgents } from '@/features/agents/use-agents';
import { useCheques } from '@/features/account/use-account';
import {
  useBankBounceCharges,
  useChequeBounces,
  useCreateBounce,
  useDeleteBounce,
  useSaveBankBounceCharge,
} from './use-agent-commission';

const TH = 'bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap';
const TD = 'px-2 py-1.5 text-[12.5px]';
const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Every cheque bounce, and the bank charges that follow from it.
 *
 * A cheque can bounce any number of times — each deposit is its own event with
 * its own charge and its own bank memo photograph. That photo is the whole
 * point: when an agent disputes a deduction months later, the proof has to be
 * one tap away.
 *
 * This lives inside Manage Cheques rather than on a screen of its own — a
 * bounce is something that happens TO a cheque, so it belongs beside them.
 */
export function ChequeBounceRegister() {
  const { can } = usePermissions();
  const confirm = useConfirm();

  const { data: agents } = useAgents({ page: 1, pageSize: 500 });
  const [filterAgent, setFilterAgent] = useState('');
  const agentOptions = useMemo(() => (agents?.items ?? []).map((a) => a.name), [agents]);
  const filterAgentId = useMemo(() => (agents?.items ?? []).find((a) => a.name === filterAgent)?.id, [agents, filterAgent]);

  // With no agent chosen the hook is disabled, so ask for every bounce by
  // passing a chequeId of 0 — the API treats "no filter" as "all".
  const { data: bounces, isLoading } = useChequeBounces(filterAgentId ? undefined : 0, filterAgentId);
  const rows = bounces ?? [];

  const del = useDeleteBounce();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <NativeSelect value={filterAgent} onChange={setFilterAgent} options={['', ...agentOptions]} placeholder="All agents" />
        </div>
        <span className="text-muted-foreground text-sm">
          {rows.length} bounce{rows.length === 1 ? '' : 's'} recorded
        </span>
      </div>

      <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[4px] border shadow-sm">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={TH}>Bounced on</th>
                <th className={TH}>Cheque</th>
                <th className={TH}>Party</th>
                <th className={TH}>Brought by</th>
                <th className={TH}>Bank</th>
                <th className={cn(TH, 'text-right')}>Charge</th>
                <th className={TH}>Reason</th>
                <th className={TH}>Proof</th>
                <th className={cn(TH, 'w-10')} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="h-28 text-center"><Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" /></td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={9} className="text-muted-foreground h-28 text-center text-[13px] font-medium">No bounces recorded.</td></tr>
              ) : (
                rows.map((b) => (
                  <tr key={b.id} className={cn('border-b border-amber-200/70 even:bg-amber-50/40', b.recovered && 'opacity-60')}>
                    <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>{formatDate(b.bounceDate)}</td>
                    <td className={cn(TD, 'font-mono font-bold')}>{b.chequeNo}</td>
                    <td className={cn(TD, 'font-semibold')}>{b.partyName}</td>
                    <td className={TD}>
                      {b.agentName ?? <span className="text-muted-foreground">party direct</span>}
                    </td>
                    <td className={TD}>{b.bankName ?? '—'}</td>
                    <td className={cn(TD, 'text-right font-bold tabular-nums text-rose-700')}>
                      {inr(b.totalCharge)}
                      <span className="text-muted-foreground ml-1 text-[10px]">{b.charge}+{b.gstPercent}%</span>
                    </td>
                    <td className={cn(TD, 'text-muted-foreground max-w-40 truncate')} title={b.reason ?? ''}>{b.reason || '—'}</td>
                    <td className={TD}>
                      {b.receiptUrl ? (
                        <a href={b.receiptUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 font-semibold hover:underline">
                          <Camera className="size-3.5" /> View
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">none</span>
                      )}
                    </td>
                    <td className="px-1">
                      {/* Once a bounce has been deducted on a paid settlement it is
                          part of that settlement's arithmetic — the API refuses,
                          so don't offer it. */}
                      {can('agentcommission:delete') && !b.recovered && (
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Remove this bounce?`,
                              description: `${b.chequeNo} · ${formatDate(b.bounceDate)} · ${inr(b.totalCharge)}. Only do this if it was recorded by mistake.`,
                              confirmText: 'Remove',
                              destructive: true,
                            });
                            if (ok) del.mutate(b.id, { onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')) });
                          }}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-7 items-center justify-center rounded-[4px]"
                          aria-label={`Remove bounce for ${b.chequeNo}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                      {b.recovered && <span className="text-muted-foreground text-[10px] font-bold">deducted</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Record a bounce ──────────────────────────────────────────────────────── */

/** `forCheque` is passed when recording from a cheque's own row, so the user
 *  never has to find the cheque number again. */
export function RecordBounceDialog({ forCheque, onClose }: { forCheque?: ChequeDto | null; onClose: () => void }) {
  const { data: cheques } = useCheques({ page: 1, pageSize: 300 } as never);
  const { data: charges } = useBankBounceCharges();
  const create = useCreateBounce();
  const fileRef = useRef<HTMLInputElement>(null);

  const [chequeNo, setChequeNo] = useState(forCheque?.chequeNo ?? '');
  const cheque = useMemo(
    () => forCheque ?? (cheques?.items ?? []).find((c) => c.chequeNo === chequeNo),
    [forCheque, cheques, chequeNo],
  );
  const options = useMemo(() => (cheques?.items ?? []).map((c) => c.chequeNo), [cheques]);

  const [bounceDate, setBounceDate] = useState(ymd(new Date()));
  // Defaults to the bank the cheque was to be deposited into — that is the bank
  // that will actually levy the charge.
  const [bankName, setBankName] = useState(forCheque?.drawerBank ?? '');
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState<{ url: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Show what the bank's configured charge will be, so it is never a surprise.
  const cfg = useMemo(() => (charges ?? []).find((c) => c.bankName === (bankName || cheque?.drawerBank)), [charges, bankName, cheque]);

  const pickPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!looksLikeImage(file)) return toast.error('That file is not an image.');
    setUploading(true);
    try {
      // Downscaled first — a phone photo of a bank memo is several MB otherwise.
      const prepared = await prepareImageForUpload(file);
      const up = await uploadFile(prepared, undefined, 'bounce-receipts');
      setReceipt({ url: up.url, path: up.path });
      toast.success('Receipt attached');
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Upload failed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = () => {
    if (!cheque) return toast.error('Choose the cheque that bounced.');
    if (!bounceDate) return toast.error('When did it bounce?');
    if (bounceDate > ymd(new Date())) return toast.error('A bounce cannot be dated in the future — the bank has not returned it yet.');
    if (bounceDate < ymd(new Date(cheque.recDate))) {
      return toast.error(`Cheque ${cheque.chequeNo} was only received on ${new Date(cheque.recDate).toLocaleDateString('en-IN')} — it cannot have bounced before that.`);
    }
    if (cheque.status === 'CLEARED') return toast.error(`Cheque ${cheque.chequeNo} is marked CLEARED. Check you picked the right one.`);
    if (!cfg) return toast.error(`No bounce charge is set for ${bankName || cheque.drawerBank || 'this bank'} — set it under Bank charges first, or it will record as ₹0.`);
    create.mutate(
      {
        chequeId: cheque.id,
        bounceDate,
        bankName: bankName.trim() || undefined,
        reason: reason.trim() || undefined,
        receiptUrl: receipt?.url,
        receiptPath: receipt?.path,
      },
      {
        onSuccess: (b) => { toast.success(`Bounce recorded — ${inr(b.totalCharge)} charge`); onClose(); },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not record the bounce')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TriangleAlert className="size-5 text-rose-600" /> Record a cheque bounce</DialogTitle>
          <DialogDescription>
            Each deposit that bounces is its own record — recording a second bounce on the same cheque adds a second charge.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Cheque</Label>
            {forCheque ? (
              <p className="rounded-[4px] border bg-muted/40 px-3 py-2 font-mono text-sm font-bold">{forCheque.chequeNo}</p>
            ) : (
              <NativeSelect value={chequeNo} onChange={setChequeNo} options={options} placeholder="Cheque number…" />
            )}
            {cheque && (
              <p className="text-muted-foreground text-[11.5px]">
                {cheque.partyName} · {inr(cheque.chequeAmt)}
                {cheque.agentName ? ` · brought by ${cheque.agentName}` : ' · handed over by the party'}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Bounced on</Label>
              <Input type="date" className="tabular-nums" value={bounceDate} onChange={(e) => setBounceDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Our bank</Label>
              <NativeSelect value={bankName} onChange={setBankName} options={(charges ?? []).map((c) => c.bankName)} placeholder="Bank…" />
            </div>
          </div>
          <p className="text-muted-foreground text-[12px]">
            {cfg ? <>Charge will be <span className="text-foreground font-bold">{inr(cfg.total)}</span> ({cfg.charge} + {cfg.gstPercent}% GST).</>
                 : 'No charge configured for this bank — it will record as ₹0. Set it under Bank charges.'}
          </p>
          <div className="space-y-1">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Insufficient funds" />
          </div>

          {/* The proof. `capture` opens the camera straight away on a phone. */}
          <div className="space-y-1">
            <Label>Bank memo photo</Label>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickPhoto(e.target.files)} />
            {receipt ? (
              <div className="relative w-fit">
                <img src={receipt.url} alt="Bounce receipt" className="max-h-40 rounded-md border" />
                <button type="button" onClick={() => setReceipt(null)} className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-white text-rose-600 shadow ring-1 ring-black/5" aria-label="Remove photo">
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <Camera />} Photograph the receipt
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={save} disabled={create.isPending || uploading}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Record bounce
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Bank-wise charges ────────────────────────────────────────────────────── */

export function BankChargesDialog({ onClose }: { onClose: () => void }) {
  const { data: charges } = useBankBounceCharges();
  const save = useSaveBankBounceCharge();
  const [form, setForm] = useState({ bankName: '', charge: '', gstPercent: '18' });

  const preview = bounceTotal(Number(form.charge) || 0, Number(form.gstPercent) || 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Landmark className="size-5" /> Cheque bounce charges by bank</DialogTitle>
          <DialogDescription>Applies to agent- and party-provided cheques alike.</DialogDescription>
        </DialogHeader>

        <div className="rounded-[4px] border">
          <table className="w-full border-collapse">
            <thead><tr><th className={TH}>Bank</th><th className={cn(TH, 'text-right')}>Charge</th><th className={cn(TH, 'text-right')}>GST</th><th className={cn(TH, 'text-right')}>Total</th></tr></thead>
            <tbody>
              {!charges?.length ? (
                <tr><td colSpan={4} className="text-muted-foreground h-16 text-center text-[12.5px]">None set yet.</td></tr>
              ) : charges.map((c) => (
                <tr key={c.id} className="border-b even:bg-amber-50/40">
                  <td className={cn(TD, 'font-semibold')}>{c.bankName}</td>
                  <td className={cn(TD, 'text-right tabular-nums')}>{c.charge}</td>
                  <td className={cn(TD, 'text-right tabular-nums')}>{c.gstPercent}%</td>
                  <td className={cn(TD, 'text-right font-bold tabular-nums')}>{inr(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1">
            <Label>Bank</Label>
            <Input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="AXIS BANK" />
          </div>
          <div className="space-y-1">
            <Label>Charge ₹</Label>
            <Input type="number" step="any" min={0} className="w-24 text-right tabular-nums" value={form.charge} onChange={(e) => setForm((f) => ({ ...f, charge: e.target.value }))} placeholder="100" />
          </div>
          <div className="space-y-1">
            <Label>GST %</Label>
            <Input type="number" step="any" min={0} className="w-20 text-right tabular-nums" value={form.gstPercent} onChange={(e) => setForm((f) => ({ ...f, gstPercent: e.target.value }))} />
          </div>
          <Button
            onClick={() => {
              if (!form.bankName.trim()) return toast.error('Enter the bank name.');
              save.mutate(
                { bankName: form.bankName.trim(), charge: Number(form.charge) || 0, gstPercent: Number(form.gstPercent) || 0 },
                { onSuccess: () => { toast.success('Charge saved'); setForm({ bankName: '', charge: '', gstPercent: '18' }); },
                  onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
              );
            }}
            disabled={save.isPending}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Save
          </Button>
        </div>
        {Number(form.charge) > 0 && <p className="text-muted-foreground text-[12px]">A bounce on this bank will cost <span className="text-foreground font-bold">{inr(preview)}</span>.</p>}

        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
