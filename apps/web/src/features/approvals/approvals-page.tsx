import { useState } from 'react';
import { ChevronLeft, ChevronRight, Check, Clock, Loader2, Search, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ApprovalRequestDto, ApprovalStatus } from '@oms/shared';
import { APPROVAL_TYPE_LABELS, APPROVAL_TYPES } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { getApiErrorMessage } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useApprovals, useApproveRequest, useRejectRequest } from './use-approvals';

const PAGE_SIZE = 50;

/** Compact, amber-bordered filter controls — the same language as every list page. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

const STATUS_TABS: { id: ApprovalStatus | 'ALL'; label: string }[] = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'ALL', label: 'All' },
];

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30',
  APPROVED: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/15 dark:text-emerald-300 dark:ring-emerald-400/30',
  REJECTED: 'bg-rose-100 text-rose-700 ring-rose-600/20 dark:bg-rose-400/15 dark:text-rose-300 dark:ring-rose-400/30',
  CANCELLED: 'bg-slate-200 text-slate-600 ring-slate-400/20 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15',
};
const STATUS_DOT: Record<string, string> = {
  PENDING: 'bg-amber-500',
  APPROVED: 'bg-emerald-500',
  REJECTED: 'bg-rose-500',
  CANCELLED: 'bg-slate-400',
};

/** A status pill with a coloured dot — carries the state alongside the word so
 *  it never relies on colour alone (matches Orders/Challans). */
function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', STATUS_STYLE[status] ?? 'bg-muted text-muted-foreground ring-border')}>
      <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status] ?? 'bg-slate-400')} />
      {status}
    </span>
  );
}

/**
 * The universal Approvals inbox — every action the app held back because the
 * requester lacked a permission (first one: a dispatch back-dated by someone
 * without `dispatch:approve`) lands here. Approving replays the held action
 * exactly as if the requester had had the right all along; rejecting requires a
 * reason so the requester knows why.
 */
export function ApprovalsPage() {
  const { can } = usePermissions();
  const canDecide = can('approval:approve');

  const [status, setStatus] = useState<ApprovalStatus | 'ALL'>('PENDING');
  const [type, setType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<ApprovalRequestDto | null>(null);

  const query = { page, pageSize: PAGE_SIZE, status, type: type || undefined, search: searchInput.trim() || undefined };
  const { data, isLoading, isFetching } = useApprovals(query);
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const columns: DataColumn<ApprovalRequestDto>[] = [
    {
      id: 'code',
      label: 'Code',
      pin: 'left0',
      fixed: true,
      cell: (r) => <span className="text-[13px] font-bold text-amber-900 dark:text-amber-300">{r.code}</span>,
    },
    {
      id: 'type',
      label: 'Type',
      cell: (r) => <span className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{r.typeLabel}</span>,
    },
    {
      id: 'title',
      label: 'Request',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-200">{r.title}</p>
          {r.summary && <p className="text-muted-foreground truncate text-[11.5px] font-medium">{r.summary}</p>}
        </div>
      ),
    },
    {
      id: 'requested',
      label: 'Requested',
      cell: (r) => (
        <div className="whitespace-nowrap">
          <p className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">{r.requestedByName ?? '—'}</p>
          <p className="text-muted-foreground text-[11px] font-medium tabular-nums">{formatDateTime(r.requestedAt)}</p>
        </div>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => <StatusPill status={r.status} />,
    },
    {
      id: 'decided',
      label: 'Decided',
      noSort: true,
      cell: (r) =>
        r.decidedAt ? (
          <div className="whitespace-nowrap" title={r.decisionNote ?? undefined}>
            <p className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">{r.decidedByName ?? '—'}</p>
            <p className="text-muted-foreground text-[11px] font-medium tabular-nums">{formatDateTime(r.decidedAt)}</p>
          </div>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
  ];

  // Phones: one stacked card per request.
  const mobileCard = (r: ApprovalRequestDto) => (
    <div className="space-y-2" onClick={() => setActive(r)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] leading-tight font-bold text-slate-900 dark:text-slate-100">{r.title}</p>
          <p className="text-muted-foreground mt-0.5 text-[11.5px] font-medium">
            {r.code} · {r.typeLabel}
          </p>
        </div>
        <StatusPill status={r.status} />
      </div>
      {r.summary && <p className="text-muted-foreground text-[12px] font-medium">{r.summary}</p>}
      <div className="text-muted-foreground flex items-center justify-between border-t pt-2 text-[11.5px] font-medium">
        <span>{r.requestedByName ?? '—'}</span>
        <span className="tabular-nums">{formatDateTime(r.requestedAt)}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <ShieldCheck className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Approvals</h2>
          <p className="text-muted-foreground text-sm">
            Actions held back for a sign-off — approve to apply them, reject to send them back.
          </p>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────────── */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="inline-flex items-center gap-0.5 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40 dark:bg-transparent">
            {STATUS_TABS.map((t) => {
              const on = status === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setStatus(t.id);
                    setPage(1);
                  }}
                  aria-pressed={on}
                  className={cn(
                    'cursor-pointer rounded-[3px] px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap transition-colors duration-150',
                    on
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="w-48">
            <NativeSelect
              value={type}
              onChange={(v) => {
                setType(v);
                setPage(1);
              }}
              options={['', ...APPROVAL_TYPES.map((t) => ({ value: t, label: APPROVAL_TYPE_LABELS[t] }))]}
              placeholder="All types"
              className={cn(CONTROL, 'font-medium', type && CONTROL_ON)}
            />
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search code, title, requester…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <p className="text-muted-foreground shrink-0 text-[12px] font-medium tabular-nums">
            <span className="font-bold text-foreground">{(data?.total ?? 0).toLocaleString('en-IN')}</span> request
            {(data?.total ?? 0) === 1 ? '' : 's'}
            {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin align-[-2px]" />}
          </p>
        </div>
      </div>

      {/* ── The list ───────────────────────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        emptyText={status === 'PENDING' ? 'Nothing waiting on a decision.' : 'No requests match these filters.'}
        onRowClick={(r) => setActive(r)}
        mobileCard={mobileCard}
      />

      {/* ── Footer: paging ─────────────────────────────────────────────────────── */}
      <div className="bg-card flex items-center justify-between rounded-[4px] border px-3 py-2 shadow-sm">
        <p className="text-muted-foreground text-[12px] font-medium">
          Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
          <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next <ChevronRight />
          </Button>
        </div>
      </div>

      {active && <DecisionDialog request={active} canDecide={canDecide} onClose={() => setActive(null)} />}
    </div>
  );
}

/** Detail + decision dialog. Always shows the full request; Approve/Reject only
 *  render for a PENDING request when the viewer has `approval:approve`. */
function DecisionDialog({
  request,
  canDecide,
  onClose,
}: {
  request: ApprovalRequestDto;
  canDecide: boolean;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const approve = useApproveRequest(request.id);
  const reject = useRejectRequest(request.id);
  const isPending = request.status === 'PENDING';
  const saving = approve.isPending || reject.isPending;

  const doApprove = () => {
    approve.mutate(
      { note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`${request.code} approved`);
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Approve failed')),
      },
    );
  };
  const doReject = () => {
    if (!note.trim()) return toast.error('Add a short reason so the requester knows why.');
    reject.mutate(
      { note: note.trim() },
      {
        onSuccess: () => {
          toast.success(`${request.code} rejected`);
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Reject failed')),
      },
    );
  };

  // A handful of payload fields read cleanly without a per-type renderer —
  // anything else is dropped rather than dumping raw JSON on the user.
  const FRIENDLY_KEYS: Record<string, string> = {
    customerName: 'Customer',
    orderCode: 'Order',
    productName: 'Product',
    dispatchDate: 'Requested date',
    currentDate: 'Current date',
    dispatchCode: 'Dispatch',
    dispatchStatus: 'Type',
  };
  const DATE_KEYS = new Set(['dispatchDate', 'currentDate']);
  const payloadRows = Object.entries(request.payload)
    .filter(([k, v]) => FRIENDLY_KEYS[k] && v != null && v !== '')
    .map(([k, v]) => [k, DATE_KEYS.has(k) ? formatDate(String(v)) : String(v)] as [string, string]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-amber-900 dark:text-amber-300">{request.code}</span>
            <StatusPill status={request.status} />
          </DialogTitle>
          <DialogDescription>{request.typeLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">{request.title}</p>
            {request.summary && <p className="text-muted-foreground text-[12.5px]">{request.summary}</p>}
          </div>

          {payloadRows.length > 0 && (
            <div className="rounded-[4px] border bg-muted/30 p-2.5">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                {payloadRows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground font-medium">{FRIENDLY_KEYS[k]}</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
            <Clock className="size-3.5" />
            Requested by <span className="text-foreground font-semibold">{request.requestedByName ?? '—'}</span> on{' '}
            {formatDateTime(request.requestedAt)}
          </div>

          {request.decidedAt && (
            <div
              className={cn(
                'rounded-[4px] border p-2.5 text-[12.5px]',
                request.status === 'APPROVED'
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-400/10'
                  : 'border-rose-200 bg-rose-50 dark:border-rose-400/30 dark:bg-rose-400/10',
              )}
            >
              <p className="font-semibold">
                {request.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {request.decidedByName ?? '—'} ·{' '}
                {formatDateTime(request.decidedAt)}
              </p>
              {request.decisionNote && <p className="text-muted-foreground mt-1">{request.decisionNote}</p>}
            </div>
          )}

          {isPending && canDecide && (
            <div className="space-y-1.5">
              <Label htmlFor="decision-note">{rejecting ? 'Reason for rejecting *' : 'Note (optional)'}</Label>
              <textarea
                id="decision-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={rejecting ? 'Explain why this is being rejected…' : 'Add a note for the record…'}
                className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-[4px] border bg-transparent px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:ring-[3px]"
              />
            </div>
          )}
        </div>

        {isPending && canDecide ? (
          <DialogFooter className="gap-2 sm:justify-between">
            {!rejecting ? (
              <>
                <Button type="button" variant="outline" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setRejecting(true)} disabled={saving}>
                  <X /> Reject
                </Button>
                <Button type="button" onClick={doApprove} disabled={saving}>
                  {approve.isPending ? <Loader2 className="animate-spin" /> : <Check />} Approve
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setRejecting(false)} disabled={saving}>
                  Back
                </Button>
                <Button type="button" variant="destructive" onClick={doReject} disabled={saving}>
                  {reject.isPending ? <Loader2 className="animate-spin" /> : <X />} Confirm reject
                </Button>
              </>
            )}
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
