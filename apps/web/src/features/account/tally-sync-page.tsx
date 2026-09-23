import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type {
  SaveTallyMappingInput,
  TallyConfig,
  TallyMappingList,
  TallyPartyMapping,
  TallyPostResult,
  TallyPostStatus,
  TallyQueueRow,
  TallyPreview,
  TallyPreviewTest,
  TallyRecon,
  TallyReconResult,
  TallyReconRow,
  TallyState,
  TallyStatus,
  TallySuggestionSource,
} from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const KEY = ['tally', 'status'] as const;
const MAP_KEY = ['tally', 'mapping'] as const;

const SOURCE_LABEL: Record<TallySuggestionSource, string> = {
  UPLOAD: 'your Tally upload mapping',
  LAST_BILL: 'from last Tally bill',
};
const CHIP = 'rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap';
const GREEN = 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25';
const AMBER = 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/25';
const RED = 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/25';
const BLUE = 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-400/15 dark:text-sky-200 dark:ring-sky-400/25';

function statusChip(r: TallyPartyMapping) {
  if (r.status === 'OK') return <span className={cn(CHIP, GREEN)}>Mapped</span>;
  if (r.status === 'GSTIN_CHANGED') return <span className={cn(CHIP, RED)} title={`Confirmed with GSTIN ${r.savedGstin ?? 'none'}`}>GSTIN changed in Tally — re-confirm</span>;
  if (r.status === 'MISSING') return <span className={cn(CHIP, RED)} title={`Was ${r.savedName}`}>Ledger gone from Tally</span>;
  if (r.uploadLedgerName)
    return <span className={cn(CHIP, AMBER)}>Upload said “{r.uploadLedgerName}”, last bill went here — choose</span>;
  if (r.suggestion) return <span className={cn(CHIP, BLUE)}>Suggested · {SOURCE_LABEL[r.suggestion.source]}</span>;
  return <span className={cn(CHIP, AMBER)}>Not mapped</span>;
}

const RECON_KEY = ['tally', 'recon'] as const;
const RECON_LABEL: Record<TallyRecon, string> = {
  OK: 'OK',
  MISSING_IN_TALLY: 'Not in Tally',
  CANCELLED_IN_TALLY: 'Cancelled in Tally only',
  CANCELLED_IN_OMS: 'Cancelled in OMS only',
  AMOUNT_MISMATCH: 'Amount differs',
  PARTY_MISMATCH: 'Party differs',
  DATE_MISMATCH: 'Date differs',
  TALLY_ONLY: 'In Tally, not in OMS',
};
const rs = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

/** This FY's OMS invoices against their Tally vouchers, and every difference. */
function BillCheck({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [showAccepted, setShowAccepted] = useState(false);
  const { data } = useQuery({ queryKey: RECON_KEY, queryFn: () => http.get<TallyReconResult>('/tally/recon') });
  const onDone = (r: TallyReconResult) => qc.setQueryData(RECON_KEY, r);
  const run = useMutation({
    mutationFn: () => http.post<TallyReconResult>('/tally/recon/run'),
    onSuccess: (r) => {
      onDone(r);
      qc.invalidateQueries({ queryKey: QUEUE_KEY });
      toast.success(`Checked ${r.linked} bills`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
  const [accepting, setAccepting] = useState<TallyReconRow | null>(null);
  const [note, setNote] = useState('');
  const accept = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) => http.post<TallyReconResult>(`/tally/recon/${id}/accept`, { note }),
    onSuccess: (r) => {
      onDone(r);
      setAccepting(null);
      setNote('');
      toast.success('Accepted');
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  const rows = data?.rows ?? [];
  const open = rows.filter((r) => !r.accepted);
  const shown = showAccepted ? rows : open;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Bills: OMS ↔ Tally (this year)</CardTitle>
          <CardDescription>
            {data?.checkedAt
              ? `${data.linked} bills linked · ${data.ok} match · ${open.length} to look at · checked ${formatDateTime(data.checkedAt)}`
              : 'Not checked yet. Run the check to link this year’s bills to their Tally vouchers.'}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {rows.length > open.length && (
            <Button variant="outline" size="sm" onClick={() => setShowAccepted((v) => !v)}>
              {showAccepted ? 'Hide accepted' : `Show accepted (${rows.length - open.length})`}
            </Button>
          )}
          {canManage && (
            <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Check now
            </Button>
          )}
        </div>
      </CardHeader>
      {data?.checkedAt && (
        <CardContent>
          {!shown.length ? (
            <p className="text-sm">Every bill matches Tally. ✓</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">OMS</th>
                    <th className="py-1.5 pr-2 font-medium">Tally</th>
                    <th className="py-1.5 pr-2 font-medium">Difference</th>
                    {canManage && <th className="py-1.5 font-medium" />}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="py-2 pr-2">
                        {r.oms ? (
                          <>
                            <div className="font-semibold">{r.oms.code}</div>
                            <div className="text-muted-foreground text-xs">
                              {formatDate(r.oms.date)} · {r.oms.customerName} · B {rs(r.oms.amount)}
                              {r.oms.status === 'CANCELLED' && ' · cancelled'}
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        {r.tally ? (
                          <>
                            <div className="font-semibold">{r.tally.vchNo}</div>
                            <div className="text-muted-foreground text-xs">
                              {r.tally.date ? formatDate(r.tally.date) : '—'} · {r.tally.party} · {rs(r.tally.amount)}
                              {r.tally.cancelled && ' · cancelled'}
                              {r.tally.irn && ' · IRN'}
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={cn(CHIP, r.accepted ? GREEN : r.recon === 'DATE_MISMATCH' ? AMBER : RED)}>{RECON_LABEL[r.recon]}</span>
                        <div className="mt-1 text-xs">{r.note}</div>
                        {r.accepted && (
                          <div className="text-muted-foreground mt-1 text-xs">
                            Accepted by {r.acceptedBy ?? '—'}: {r.acceptedNote}
                          </div>
                        )}
                      </td>
                      {canManage && (
                        <td className="py-2 text-right">
                          {!r.accepted && (
                            <Button size="sm" variant="outline" onClick={() => setAccepting(r)}>
                              Accept
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}

      <Dialog open={!!accepting} onOpenChange={(o) => !o && setAccepting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Accept this difference?</DialogTitle>
            <DialogDescription>
              {accepting?.oms?.code ?? accepting?.tally?.vchNo} · {accepting && RECON_LABEL[accepting.recon]}
              <br />
              {accepting?.note}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (accepting && note.trim().length >= 3) accept.mutate({ id: accepting.id, note: note.trim() });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="accept-note">Why is it fine?</Label>
              <Input id="accept-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Credit note 9 given in Tally" autoFocus />
              <p className="text-muted-foreground text-xs">It comes back on the list if this voucher is changed in Tally later.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAccepting(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={note.trim().length < 3 || accept.isPending}>
                {accept.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Accept
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const QUEUE_KEY = ['tally', 'queue'] as const;
const POST_LABEL: Record<TallyPostStatus, [string, string]> = {
  NOT_POSTED: ['Not in Tally', AMBER],
  POSTING: ['Sending…', BLUE],
  POSTED: ['Posted', GREEN],
  FAILED: ['Tally refused', RED],
  UNKNOWN: ['Not sure — check', RED],
};

/** This year's bills not in Tally yet. The only place OMS writes to Tally. */
function PostQueue({ canPost, canManage }: { canPost: boolean; canManage: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [showBlocked, setShowBlocked] = useState(false);
  // Link bills entered directly in Tally before deciding what is still pending.
  const tallyCheck = useQuery({
    queryKey: ['tally', 'queue-live-check'],
    queryFn: async () => {
      const result = await http.post<TallyReconResult>('/tally/recon/run');
      qc.setQueryData(RECON_KEY, result);
      return result;
    },
    enabled: canManage,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: () => http.get<TallyQueueRow[]>('/tally/queue'),
    enabled: !canManage || !tallyCheck.isPending,
  });
  const refresh = async () => {
    if (canManage) await tallyCheck.refetch();
    await refetch();
  };
  const done = (r: TallyPostResult) => {
    const say = r.status === 'POSTED' ? toast.success : r.status === 'FAILED' ? toast.error : toast.warning;
    say(r.message, { description: r.warnings.length ? `Check in Tally: ${r.warnings.join(' · ')}` : undefined, duration: 12_000 });
    qc.invalidateQueries({ queryKey: QUEUE_KEY });
    qc.invalidateQueries({ queryKey: RECON_KEY });
  };
  const post = useMutation({ mutationFn: (code: string) => http.post<TallyPostResult>('/tally/post', { code }), onSuccess: done, onError: (e) => toast.error(getApiErrorMessage(e)) });
  const resolve = useMutation({ mutationFn: (code: string) => http.post<TallyPostResult>('/tally/resolve', { code }), onSuccess: done, onError: (e) => toast.error(getApiErrorMessage(e)) });
  const busy = post.isPending || resolve.isPending;

  const checkingTally = canManage && (tallyCheck.isPending || tallyCheck.isFetching);
  const rows = checkingTally ? [] : data ?? [];
  const ready = rows.filter((r) => !r.blocks.length || r.status === 'UNKNOWN');
  const shown = showBlocked ? rows : ready;

  const onPost = async (r: TallyQueueRow) => {
    const ok = await confirm({
      title: `Post ${r.code} to Tally?`,
      description: `${r.customerName} · ${rs(r.amount)}. After posting, open it in Tally and check it — make the e-invoice only then.`,
      confirmText: 'Post to Tally',
    });
    if (ok) post.mutate(r.code);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>To post to Tally</CardTitle>
          <CardDescription>
            {checkingTally
              ? 'Checking bills already entered in Tally…'
              : `This year’s bills still to check: ${ready.length} ready${rows.length > ready.length ? `, ${rows.length - ready.length} need review` : ''}.`}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {rows.length > ready.length && (
            <Button variant="outline" size="sm" onClick={() => setShowBlocked((v) => !v)}>
              {showBlocked ? 'Ready only' : `Show all (${rows.length})`}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isFetching || checkingTally}>
            {isFetching || checkingTally ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {tallyCheck.error && canManage && (
          <p className="mb-3 text-sm text-red-700 dark:text-red-300">
            Could not check live Tally: {getApiErrorMessage(tallyCheck.error)}. This list may be out of date.
          </p>
        )}
        {checkingTally ? (
          <p className="text-muted-foreground text-sm">Checking Tally…</p>
        ) : error ? (
          <p className="text-sm text-red-700 dark:text-red-300">{getApiErrorMessage(error)}</p>
        ) : !data ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : !shown.length ? (
          <p className="text-sm">Nothing to post. ✓</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Bill</th>
                  <th className="py-1.5 pr-2 font-medium">Status</th>
                  {canPost && <th className="py-1.5 font-medium" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((r) => {
                  const [label, tone] = POST_LABEL[r.status];
                  return (
                    <tr key={r.challanId} className="align-top">
                      <td className="py-2 pr-2">
                        <div className="font-semibold">{r.code}</div>
                        <div className="text-muted-foreground text-xs">
                          {formatDate(r.date)} · {r.customerName} · B {rs(r.amount)}
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <span className={cn(CHIP, r.blocks.length && r.status === 'NOT_POSTED' ? AMBER : tone)}>
                          {r.blocks.length && r.status === 'NOT_POSTED' ? 'Needs review' : label}
                        </span>
                        {r.lastError && <div className="mt-1 text-xs text-red-700 dark:text-red-300">{r.lastError}</div>}
                        {r.blocks.map((b) => (
                          <div key={b} className="text-muted-foreground mt-1 text-xs">
                            {b}
                          </div>
                        ))}
                      </td>
                      {canPost && (
                        <td className="py-2 text-right">
                          {r.status === 'UNKNOWN' ? (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve.mutate(r.code)}>
                              Check again
                            </Button>
                          ) : (
                            !r.blocks.length &&
                            (r.status === 'NOT_POSTED' || r.status === 'FAILED') && (
                              <Button size="sm" disabled={busy} onClick={() => onPost(r)}>
                                {post.isPending && post.variables === r.code && <Loader2 className="size-3.5 animate-spin" />}
                                {r.status === 'FAILED' ? 'Post again' : 'Post to Tally'}
                              </Button>
                            )
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** What OMS would send to Tally — built and checked, never sent. */
function PostingPreview() {
  const [code, setCode] = useState('');
  const preview = useMutation({
    mutationFn: (c: string) => http.get<TallyPreview>('/tally/preview', { params: { code: c } }),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => http.post<TallyPreviewTest>('/tally/preview/test'),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
  const p = preview.data;
  const t = test.data;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Posting preview</CardTitle>
          <CardDescription>What OMS would send to Tally for a bill. Nothing is written to Tally.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending && <Loader2 className="size-3.5 animate-spin" />}
          Test on this year’s bills
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {t && (
          <div className="space-y-3 rounded border p-3 text-sm">
            <div className="font-semibold text-emerald-700 dark:text-emerald-300">
              ✅ Nothing to fix — this only compares this year’s old bills, already in Tally. OMS will not send them again.
            </div>
            <div>
              <b>{t.identical}</b> of <b>{t.tested}</b> full bills: what OMS would send is identical to what was typed in Tally.
            </div>
            {t.mismatches.length > 0 && (
              <details>
                <summary className="cursor-pointer">
                  {t.mismatches.length} old bills differ slightly (an old ledger, or ₹1 of rounding typed by hand) — no action needed
                </summary>
                <div className="mt-1 space-y-0.5 pl-4">
                  {t.mismatches.map((m) => (
                    <div key={m.challanId} className="text-muted-foreground text-xs">
                      <b>{m.code}</b> {m.customerName}: {m.differences?.join(' · ')}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {t.skipped.length > 0 && (
              <details>
                <summary className="cursor-pointer">Bills OMS will never post — enter these in Tally by hand</summary>
                <div className="mt-1 space-y-0.5 pl-4">
                  {t.skipped.map((s) => (
                    <div key={s.reason} className="text-muted-foreground text-xs">
                      {s.reason} — {s.count}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) preview.mutate(code.trim());
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="preview-code">Invoice no.</Label>
            <Input id="preview-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="SSS/26-27/740" className="w-48 uppercase" />
          </div>
          <Button type="submit" disabled={!code.trim() || preview.isPending}>
            {preview.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Preview
          </Button>
        </form>

        {p && (
          <div className="space-y-2 text-sm">
            <div className="font-semibold">
              {p.code} · {p.customerName}
            </div>
            {p.billingRate != null && p.billingRate > 0 && (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
                Billing rate ₹{p.billingRate}/kg · This Tally bill includes B only. Gaushala amount C ({rs(p.gaushalaAmount ?? 0)}) stays outside this Tally invoice.
              </div>
            )}
            {p.blocks.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-red-700 dark:text-red-300">
                {p.blocks.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : (
              p.voucher && (
                <>
                  <div>
                    Tally <b>{p.voucher.vchNo}</b> · {formatDate(p.voucher.date)} · party <b>{p.voucher.party}</b>
                    {p.voucher.shippedBy && ` · by ${p.voucher.shippedBy}`}
                  </div>
                  <table className="w-full max-w-2xl text-sm">
                    <tbody className="divide-y">
                      {p.voucher.lines.map((l) => (
                        <tr key={`${l.item}${l.rate}`}>
                          <td className="py-1">{l.item}</td>
                          <td className="py-1 text-right tabular-nums">
                            {l.qty} {l.unit} @ ₹{l.rate}
                          </td>
                          <td className="py-1 text-right tabular-nums">{rs(l.amount)}</td>
                        </tr>
                      ))}
                      {p.voucher.ledgers.map((l) => (
                        <tr key={l.name} className="text-muted-foreground">
                          <td className="py-1" colSpan={2}>
                            {l.name}
                          </td>
                          <td className="py-1 text-right tabular-nums">{rs(l.amount)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="py-1" colSpan={2}>
                          Total (party debit)
                        </td>
                        <td className="py-1 text-right tabular-nums">{rs(p.voucher.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {p.differences &&
                    (p.differences.length ? (
                      <div className="text-xs text-amber-800 dark:text-amber-200">Differs from the bill already in Tally: {p.differences.join(' · ')}</div>
                    ) : (
                      <div className="text-xs text-emerald-700 dark:text-emerald-300">✓ Identical to the bill already in Tally.</div>
                    ))}
                </>
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Party → Tally ledger. A party can't be posted to Tally until it is mapped here. */
function PartyMapping({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: MAP_KEY,
    queryFn: () => http.get<TallyMappingList>('/tally/mapping'),
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: (input: SaveTallyMappingInput) => http.put<{ saved: number }>('/tally/mapping', input),
    // The server re-checked each ledger against Tally before saving, so the rows
    // are updated in place — re-reading all of Tally after every Save was slow.
    onSuccess: (r, input) => {
      toast.success(`${r.saved} ${r.saved === 1 ? 'party' : 'parties'} saved`);
      const saved = new Map(input.items.map((i) => [i.customerId, i.ledgerGuid]));
      qc.setQueryData<TallyMappingList>(MAP_KEY, (old) =>
        old && {
          ...old,
          rows: old.rows.map((row) => {
            if (!saved.has(row.customerId)) return row;
            const l = old.ledgers.find((x) => x.guid === saved.get(row.customerId)) ?? null;
            return { ...row, status: l ? 'OK' : 'UNMAPPED', ledger: l, savedName: l?.name ?? null, savedGstin: l?.gstin ?? null, suggestion: null, uploadLedgerName: null };
          }),
        },
      );
      setPicked((p) => Object.fromEntries(Object.entries(p).filter(([id]) => !saved.has(Number(id)))));
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [showAll, setShowAll] = useState(false);

  const ledgers = data?.ledgers ?? [];
  const byGuid = useMemo(() => new Map(ledgers.map((l) => [l.guid, l])), [ledgers]);
  const options = useMemo(() => ledgers.map((l) => ({ value: l.guid, label: l.name, keywords: `${l.gstin ?? ''} ${l.state ?? ''}` })), [ledgers]);
  const rows = data?.rows ?? [];
  const needs = rows.filter((r) => r.status !== 'OK');
  const shown = showAll ? rows : needs;
  const choice = (r: TallyPartyMapping) => picked[r.customerId] ?? r.ledger?.guid ?? r.suggestion?.guid ?? '';
  // Disagreements (upload vs last bill) and GSTIN changes are never bulk-mapped.
  const suggested = needs.filter((r) => r.status !== 'GSTIN_CHANGED' && (picked[r.customerId] || (r.suggestion && !r.uploadLedgerName)));

  const confirmSuggested = async () => {
    const ok = await confirm({
      title: `Map ${suggested.length} parties?`,
      description: 'Each party is mapped to the ledger shown in its row. Check the rows first — you can change any of them later.',
      confirmText: 'Map them',
    });
    if (ok) save.mutate({ items: suggested.map((r) => ({ customerId: r.customerId, ledgerGuid: choice(r) })) });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Party → Tally ledger</CardTitle>
          <CardDescription>
            Which Tally ledger each party is billed to, checked live against Tally. {rows.length - needs.length} of {rows.length} mapped.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Needs action only (${needs.length})` : `Show all (${rows.length})`}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
          {canManage && suggested.length > 0 && (
            <Button size="sm" onClick={confirmSuggested} disabled={save.isPending}>
              Map all {suggested.length} suggested
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-red-700 dark:text-red-300">{getApiErrorMessage(error)}</p>
        ) : !data ? (
          <p className="text-muted-foreground text-sm">Reading ledgers from Tally…</p>
        ) : !shown.length ? (
          <p className="text-sm">Every party is mapped. ✓</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">OMS party</th>
                  <th className="py-1.5 pr-2 font-medium">Tally ledger</th>
                  <th className="py-1.5 pr-2 font-medium">GSTIN · State</th>
                  <th className="py-1.5 pr-2 font-medium">Status</th>
                  {canManage && <th className="py-1.5 font-medium" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((r) => {
                  const guid = choice(r);
                  const l = byGuid.get(guid);
                  const dirty = guid !== (r.ledger?.guid ?? '') || r.status !== 'OK';
                  return (
                    <tr key={r.customerId} className="align-top">
                      <td className="py-2 pr-2">
                        <div className="font-semibold">{r.customerName}</div>
                        <div className="text-muted-foreground text-xs">{[r.agentName, r.city].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="min-w-56 py-2 pr-2">
                        {canManage ? (
                          <Combobox
                            value={guid}
                            onChange={(v) => setPicked((p) => ({ ...p, [r.customerId]: v }))}
                            options={options}
                            placeholder="Choose ledger…"
                          />
                        ) : (
                          (l?.name ?? '—')
                        )}
                      </td>
                      <td className="py-2 pr-2 font-mono text-xs">
                        {l ? `${l.gstin ?? 'no GSTIN'} · ${l.state ?? '—'}` : '—'}
                      </td>
                      <td className="py-2 pr-2">{statusChip(r)}</td>
                      {canManage && (
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            variant={r.status === 'OK' ? 'outline' : 'default'}
                            disabled={!guid || !dirty || (save.isPending && save.variables?.items.some((i) => i.customerId === r.customerId))}
                            onClick={() => save.mutate({ items: [{ customerId: r.customerId, ledgerGuid: guid }] })}
                          >
                            {save.isPending && save.variables?.items.some((i) => i.customerId === r.customerId) && <Loader2 className="size-3.5 animate-spin" />}
                            {r.status === 'GSTIN_CHANGED' ? 'Re-confirm' : 'Save'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const STATE_UI: Record<TallyState, { label: string; hint: string; tone: string }> = {
  OK: { label: 'Connected', hint: 'Tally is reachable and the locked company is open.', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25' },
  OFFLINE: { label: 'Tally not reachable', hint: '', tone: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/25' },
  NO_COMPANY: { label: 'No company open', hint: 'Tally is running but no company is open. Open S.S.STEEL in Tally.', tone: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/25' },
  WRONG_COMPANY: { label: 'Wrong company open', hint: 'The locked company is not open in Tally. Open it, or lock the right one below.', tone: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/25' },
  NOT_LOCKED: { label: 'Company not locked', hint: 'Tally is reachable. Lock OMS to your company below so it can never write into the wrong one.', tone: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/25' },
};

export function TallySyncPage() {
  const { can } = usePermissions();
  const canManage = can('tally:manage');
  const qc = useQueryClient();
  const { data, isFetching, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => http.get<TallyStatus>('/tally/status'),
    refetchInterval: 15_000,
  });
  const save = useMutation({
    mutationFn: (input: TallyConfig) => http.put<TallyConfig>('/tally/config', input),
    onSuccess: () => {
      toast.success('Tally settings saved');
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  const [url, setUrl] = useState('');
  useEffect(() => {
    if (data) setUrl(data.config.url);
  }, [data?.config.url]);

  const ui = data ? STATE_UI[data.state] : null;
  const locked = data?.config.companyGuid ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Tally connection</CardTitle>
            <CardDescription>Checked every 15 seconds. OMS writes to Tally only when you press “Post to Tally”.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Check now
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data || !ui ? (
            <p className="text-muted-foreground text-sm">Checking…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded px-2 py-1 text-sm font-semibold ring-1 ring-inset', ui.tone)}>{ui.label}</span>
                {data.ms != null && <span className="text-muted-foreground text-xs tabular-nums">answered in {data.ms} ms</span>}
                <span className="text-muted-foreground text-xs">· last checked {formatDateTime(data.checkedAt)}</span>
              </div>
              <p className="text-sm">{data.error ?? ui.hint}</p>
            </>
          )}
        </CardContent>
      </Card>

      {data && data.companies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Companies open in Tally</CardTitle>
            <CardDescription>OMS will only ever read from, or write to, the locked company.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {data.companies.map((c) => (
              <div key={c.guid} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-muted-foreground font-mono text-xs">{c.guid}</div>
                </div>
                {c.guid === locked ? (
                  <span className="flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    <Lock className="size-3.5" /> Locked
                  </span>
                ) : (
                  canManage && (
                    <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ url: data.config.url, companyGuid: c.guid })}>
                      Lock to this company
                    </Button>
                  )
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canManage && data && (
        <Card>
          <CardHeader>
            <CardTitle>Tally address</CardTitle>
            <CardDescription>The Tally PC's address and XML port. Change it only if the Tally PC's IP changes.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate({ url, companyGuid: locked });
              }}
            >
              <div className="min-w-64 flex-1 space-y-1">
                <Label htmlFor="tally-url">Address</Label>
                <Input id="tally-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.0.245:9000" />
              </div>
              <Button type="submit" disabled={save.isPending || !url.trim() || url.trim() === data.config.url}>
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {data?.state === 'OK' && <PostQueue canPost={can('tally:create')} canManage={canManage} />}
      {data?.state === 'OK' && <BillCheck canManage={canManage} />}
      {data?.state === 'OK' && <PostingPreview />}
      {data?.state === 'OK' && <PartyMapping canManage={canManage} />}
    </div>
  );
}
