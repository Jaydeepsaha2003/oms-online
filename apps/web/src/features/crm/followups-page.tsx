import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlarmClock, Bell, Building2, CalendarDays, Check, ChevronDown, CircleCheck, Clock, Eye, Factory, Flag, HandCoins, Handshake, Info, ListChecks, Loader2, MessageSquare, MessageSquarePlus, Mic, Package, PackageCheck, Pencil, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles, Trash2, TriangleAlert, Truck, Wallet, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { type FollowupDto, type FollowupKind, type FollowupPartyGroup } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useConfirm } from '@/components/common/confirm';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useAddChecklist,
  useAddFollowupLog,
  useCreateFollowup,
  useDeleteFollowup,
  useFollowupBoard,
  useFollowupSummary,
  useOrderItemSuggest,
  useOrderSuggest,
  usePartySuggest,
  useReopenFollowup,
  useResolveFollowup,
  useSeenFollowup,
  useSnoozeFollowup,
  useUpdateChecklistItem,
  useUpdateFollowup,
  type OpenOrderItemHit,
} from './use-crm';
import { Chip, initials, itemLine, UrgencyChip } from './crm-shared';
import { ChecklistInput, type ChecklistDraftItem } from './checklist-input';
import { OwingPartiesWorklist, PartyBalancePanel, RecoveryMoneyStrip, type CollectPrefill } from './payment-desk';
import { useOrderLookups } from '@/features/orders/use-orders';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { usePartyBalances } from './use-crm';
import type { PartyBalanceSummary } from '@oms/shared';

const STAGES = ['POLISHING', 'SUPPLIER', 'DISPATCH', 'READY'];
/** `done` is not a server-side bucket — it swaps the board over to resolved
 *  follow-ups. Without it a completed follow-up is invisible everywhere, so
 *  marking one done by mistake looks exactly like losing it. */
const DONE_BUCKET = 'done';
const BUCKETS = [
  { v: '', label: 'All open' },
  { v: 'attention', label: 'Needs attention' },
  { v: 'overdue', label: 'Overdue' },
  { v: 'today', label: 'Due today' },
  { v: 'upcoming', label: 'Upcoming' },
  { v: DONE_BUCKET, label: 'Completed' },
];

export function FollowupsPage({ kind = 'DELIVERY' }: { kind?: FollowupKind }) {
  const { can } = usePermissions();
  const canEdit = can('crm:update') || can('crm:create');
  const [bucket, setBucket] = useState('');
  const [search, setSearch] = useState('');
  // Open vs Completed. The urgency buckets only describe outstanding work, so
  // they're cleared (and hidden) while reviewing what's already been closed.
  const [status, setStatus] = useState<'OPEN' | 'DONE'>('OPEN');
  const [agentOnly, setAgentOnly] = useState(false);
  const showingDone = status === 'DONE';
  const query = useMemo(
    () => ({ kind, status, bucket: showingDone ? undefined : bucket || undefined, search: search || undefined, agentOnly: agentOnly || undefined }),
    [kind, status, showingDone, bucket, search, agentOnly],
  );
  const { data: groups = [], isLoading } = useFollowupBoard(query);
  const { data: summary } = useFollowupSummary(kind);

  const [searchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('followup');
    if (!id) return;
    const el = document.getElementById(`followup-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-indigo-400', 'ring-offset-2');
    const timer = setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-400', 'ring-offset-2'), 2200);
    return () => clearTimeout(timer);
  }, [searchParams, groups]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FollowupDto | null>(null);
  const [prefill, setPrefill] = useState<CollectPrefill | null>(null);

  const isPay = kind === 'PAYMENT';
  const isInquiry = kind === 'INQUIRY';
  const openForm = (f: FollowupDto | null) => { setEditing(f); setPrefill(null); setFormOpen(true); };
  const openCollect = (p: CollectPrefill) => { setEditing(null); setPrefill(p); setFormOpen(true); };

  // Payment desk: live party balances power the money strip + party-card badges.
  const { data: balances = [] } = usePartyBalances(undefined, isPay);
  const balByParty = useMemo(() => {
    const m = new Map<string, PartyBalanceSummary>();
    for (const b of balances) m.set(b.partyName.trim().toUpperCase(), b);
    return m;
  }, [balances]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          {isPay ? <HandCoins className="size-5" /> : isInquiry ? <MessageSquarePlus className="size-5" /> : <Bell className="size-5" />}
        </div>
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">
              {isPay ? 'Payment Recovery Desk' : isInquiry ? 'New Inquiries' : 'Follow-ups'}
            </h2>
            <HelpTip
              text={
                isPay
                  ? 'Every party who owes money, ranked worst-first — pick one and collect in one tap.'
                  : isInquiry
                    ? 'Every new enquiry that has not become an order yet — chased on the same reminder loop as any other promise.'
                    : "Every promise to a party, tracked until it's done — the system keeps nudging."
              }
            />
          </div>
          {isPay && <p className="text-muted-foreground text-sm">Who to call next, what they owe, and every promise made — all in one place.</p>}
          {isInquiry && (
            <p className="text-muted-foreground text-sm">
              Log what a party asked for and keep it in front of you until it turns into an order — or is closed off.
            </p>
          )}
        </div>
        {canEdit && (
          <Button onClick={() => openForm(null)}>
            <Plus /> {isPay ? 'New payment follow-up' : isInquiry ? 'New inquiry' : 'New follow-up'}
          </Button>
        )}
      </div>

      {/* Money-at-a-glance strip (payment recovery) */}
      {isPay && <RecoveryMoneyStrip balances={balances} />}

      {/* Owing-parties worklist — pick a party and collect (payment recovery) */}
      {isPay && <OwingPartiesWorklist onCollect={openCollect} onOpenParty={(p) => setSearch(p)} />}

      {/* Open ⇄ Completed. Completed is a review view — it answers "what did we
          actually close, and what was said when we closed it". */}
      <div className="bg-muted inline-flex rounded-lg p-1">
        {([['OPEN', 'Open'], ['DONE', 'Completed']] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setStatus(v)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors',
              status === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v === 'OPEN' ? <Bell className="size-3.5" /> : <CircleCheck className="size-3.5" />}
            {label}
          </button>
        ))}
      </div>

      {/* Follow-up KPI strip — open work only; nothing here applies to closed items. */}
      {!showingDone && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Overdue" value={summary?.overdue ?? 0} tone="rose" icon={<TriangleAlert className="size-4" />} active={bucket === 'overdue'} onClick={() => setBucket(bucket === 'overdue' ? '' : 'overdue')} />
          <Kpi label="Due today" value={summary?.dueToday ?? 0} tone="amber" icon={<Clock className="size-4" />} active={bucket === 'today'} onClick={() => setBucket(bucket === 'today' ? '' : 'today')} />
          <Kpi label="Nudging now" value={summary?.activeNudges ?? 0} tone="violet" icon={<AlarmClock className="size-4" />} active={bucket === 'attention'} onClick={() => setBucket(bucket === 'attention' ? '' : 'attention')} />
          <Kpi label="Open total" value={summary?.openTotal ?? 0} tone="sky" icon={<Bell className="size-4" />} active={bucket === ''} onClick={() => setBucket('')} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search party, title, order…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!showingDone && (
          <div className="w-48">
            {/* Labelled options, not bare keys: the combobox shows the raw value in
                its field unless the option carries a label, so picking a filter
                used to read "attention" / "today" back at you. */}
            <NativeSelect value={bucket} onChange={setBucket} options={BUCKETS.map((b) => ({ value: b.v, label: b.label }))} placeholder="All open" />
          </div>
        )}
        {/* §8 — what agents promised, as opposed to what parties promised. */}
        {isPay && (
          <Button
            type="button"
            variant={agentOnly ? 'default' : 'outline'}
            size="sm"
            className="h-9"
            onClick={() => setAgentOnly((v) => !v)}
            title="Only commitments an agent made"
          >
            <Handshake className="size-4" /> Agent promises
          </Button>
        )}
      </div>

      {/* Party-wise board */}
      {isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm"><Loader2 className="size-4 animate-spin" /> Loading follow-ups…</div>
      ) : groups.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-12 text-center text-sm">
          <CircleCheck className="mx-auto mb-3 size-10 text-emerald-500" />
          {showingDone ? 'Nothing completed yet — finished follow-ups will collect here.' : <>Nothing pending here. {canEdit && 'Log a new commitment with “New follow-up”.'}</>}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((g) => (
            <PartyCard key={g.partyName} group={g} canEdit={canEdit} onEdit={openForm} balance={balByParty.get(g.partyName.trim().toUpperCase())} done={showingDone} />
          ))}
        </div>
      )}

      {formOpen && <FollowupForm kind={kind} editing={editing} prefill={prefill} onClose={() => setFormOpen(false)} />}
    </div>
  );
}

function Kpi({ label, value, tone, icon, active, onClick }: { label: string; value: number; tone: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  const tones: Record<string, string> = {
    rose: 'text-rose-600 ring-rose-200', amber: 'text-amber-600 ring-amber-200', violet: 'text-violet-600 ring-violet-200', sky: 'text-sky-600 ring-sky-200',
  };
  return (
    <button type="button" onClick={onClick} className={cn('bg-card flex items-center gap-3 rounded-xl border p-3 text-left transition-all hover:shadow-sm', active && 'ring-2', active && tones[tone])}>
      <span className={cn('flex size-9 items-center justify-center rounded-lg ring-1 ring-inset', tones[tone])}>{icon}</span>
      <div>
        <div className={cn('text-2xl font-bold tabular-nums leading-none', tones[tone].split(' ')[0])}>{value}</div>
        <div className="text-muted-foreground mt-0.5 text-xs font-medium">{label}</div>
      </div>
    </button>
  );
}

/* ── Party card ──────────────────────────────────────────────────────────────── */

function PartyCard({ group, canEdit, onEdit, balance, done }: { group: FollowupPartyGroup; canEdit: boolean; onEdit: (f: FollowupDto) => void; balance?: PartyBalanceSummary; done?: boolean }) {
  // The card's temperature: red when something is overdue, violet while a nudge
  // is actively running, emerald once the work is closed, else a calm slate.
  const tone = done ? 'emerald' : group.overdueCount > 0 ? 'rose' : group.activeNudges > 0 ? 'violet' : 'slate';
  const RAIL: Record<string, string> = {
    rose: 'bg-rose-500', violet: 'bg-violet-500', emerald: 'bg-emerald-500', slate: 'bg-slate-300 dark:bg-slate-600',
  };
  const AVATAR: Record<string, string> = {
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    slate: 'bg-primary/10 text-primary',
  };
  // Newest completion in this group — the headline fact of a Completed card.
  const lastDone = done ? group.items.reduce((max, i) => (i.resolvedAt && i.resolvedAt > max ? i.resolvedAt : max), '') : '';

  return (
    <section className="bg-card relative overflow-hidden rounded-xl border shadow-sm transition-shadow duration-200 hover:shadow-md">
      <span className={cn('absolute inset-y-0 left-0 w-1', RAIL[tone])} aria-hidden />
      <div className="flex items-center gap-2.5 border-b bg-gradient-to-r from-slate-50/80 to-transparent py-2.5 pr-3 pl-4 dark:from-white/[0.03]">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold', AVATAR[tone])}>
          {initials(group.partyName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{group.partyName}</div>
          <div className="text-muted-foreground mt-0.5 truncate text-xs">
            {done
              ? `${group.items.length} completed${lastDone ? ` · last ${formatDate(lastDone)}` : ''}`
              : `${group.openCount} open${group.nextPromiseAt ? ` · next ${formatDate(group.nextPromiseAt)}` : ''}`}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {balance && balance.outstanding > 0 && (
            <Chip tone={balance.overdue > 0 ? 'rose' : 'amber'} className="tabular-nums">
              <span title={inrFull(balance.outstanding)}>{inrCompact(balance.outstanding)} due</span>
            </Chip>
          )}
          {done ? (
            <Chip tone="emerald"><CircleCheck className="size-3" /> Done</Chip>
          ) : (
            <>
              {group.overdueCount > 0 && <Chip tone="rose">{group.overdueCount} overdue</Chip>}
              {group.activeNudges > 0 && <Chip tone="violet"><AlarmClock className="size-3" /> {group.activeNudges}</Chip>}
            </>
          )}
        </div>
      </div>
      <div className="divide-y">
        {group.items.map((f) => <FollowupRow key={f.id} f={f} canEdit={canEdit} onEdit={onEdit} done={done} />)}
      </div>
    </section>
  );
}

function FollowupRow({ f, canEdit, onEdit, done }: { f: FollowupDto; canEdit: boolean; onEdit: (f: FollowupDto) => void; done?: boolean }) {
  const [open, setOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const confirm = useConfirm();
  const snooze = useSnoozeFollowup();
  const seen = useSeenFollowup();
  const reopen = useReopenFollowup();
  const del = useDeleteFollowup();
  const { can } = usePermissions();
  const line = itemLine(f);
  const doDelete = async () => {
    if (!(await confirm({ title: 'Delete this follow-up?', description: `“${f.title}” for ${f.partyName} will be removed.`, confirmText: 'Delete', destructive: true }))) return;
    del.mutate(f.id, { onSuccess: () => toast.success('Deleted'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) });
  };

  return (
    <div id={`followup-${f.id}`} className="rounded-md px-3 py-2.5 transition-shadow">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {f.priority === 'URGENT' && <Chip tone="rose">URGENT</Chip>}
            <span className="font-medium">{f.title}</span>
            {f.stage && <Chip tone="slate">{f.stage}</Chip>}
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {done ? (
              <Chip tone="emerald"><CircleCheck className="size-3" /> Completed{f.resolvedAt ? ` ${formatDate(f.resolvedAt)}` : ''}</Chip>
            ) : (
              <UrgencyChip f={f} />
            )}
            {line && <span className="font-mono">{line}</span>}
            {f.detail && <span className="truncate">· {f.detail}</span>}
          </div>
          {/* Why it closed — the optional comment captured on "Done", plus who closed it. */}
          {done && (
            <div className="mt-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
              <span className="font-semibold">{resolutionNote(f) ?? 'Closed with no comment.'}</span>
              {f.resolvedByName && <span className="opacity-70"> — {f.resolvedByName}</span>}
            </div>
          )}
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1" aria-label="Timeline">
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {/* Items on this follow-up, each with its quantities */}
      {(f.items ?? []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {f.items!.map((it) => {
            const q = [
              it.bags != null && `${it.bags} bags`,
              it.pcs != null && `${it.pcs} pcs`,
              it.kgs != null && `${it.kgs} kg`,
              it.box != null && `${it.box} box`,
            ]
              .filter(Boolean)
              .join(', ');
            return (
              <span key={it.id} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                <span className="font-medium">{it.productName || it.orderCode || 'Item'}</span>
                {q && <span className="text-indigo-500">· {q}</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* §8 — a promise an agent made, and the cheque it was about. Shown on the
          card so it's obvious this is the agent's word, not the party's. */}
      {(f.agentName || f.chequeNo) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {f.agentName && (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
              <Handshake className="size-3" /> promised by <span className="font-semibold">{f.agentName}</span>
            </span>
          )}
          {f.chequeNo && (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700">
              cheque {f.chequeNo}
            </span>
          )}
        </div>
      )}

      {/* Checklist — tick tasks off as they're finished */}
      {(f.checklist ?? []).length > 0 && <ChecklistProgress f={f} canEdit={canEdit} />}

      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {done ? (
            // Completed rows stay reviewable: reopen if it was closed too early.
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={reopen.isPending}
              onClick={() => reopen.mutate(f.id, { onSuccess: () => toast.success('Reopened'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) })}
            >
              <RotateCcw className="size-3" /> Reopen
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLogOpen(true)}><Pencil className="size-3" /> Update</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs text-amber-700" onClick={() => snooze.mutate(f.id, { onSuccess: () => toast.success('Snoozed — will nudge again later'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) })} disabled={snooze.isPending}>
                <AlarmClock className="size-3" /> Snooze
              </Button>
              {/* Seen acknowledges the nudge; Resolved is what actually closes it. */}
              <Button size="sm" variant="outline" className="h-7 text-xs text-sky-700" onClick={() => seen.mutate(f.id, { onSuccess: () => toast.success('Marked seen — quiet until it’s due again'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) })} disabled={seen.isPending}>
                <Eye className="size-3" /> Seen
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-700" onClick={() => setDoneOpen(true)}><Check className="size-3" /> Resolved</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(f)}><Pencil className="size-3" /> Edit</Button>
            </>
          )}
          {can('crm:delete') && <Button size="sm" variant="ghost" className="text-destructive h-7 text-xs" onClick={doDelete}><Trash2 className="size-3" /></Button>}
        </div>
      )}

      {open && (
        <div className="mt-2 space-y-1.5 rounded-lg border bg-slate-50/60 p-2.5 text-xs">
          {/* Discussion / notes captured at creation (stored in detail, one per line) */}
          {(f.detail ?? '').trim() && (
            <div className="mb-1.5 border-b pb-1.5">
              <div className="text-muted-foreground mb-1 font-semibold tracking-wide uppercase">💬 Notes</div>
              {f.detail!.split('\n').filter((s) => s.trim()).map((line, i) => (
                <div key={i} className="flex gap-1.5"><span className="text-slate-400">•</span><span>{line}</span></div>
              ))}
            </div>
          )}
          {(f.logs ?? []).length === 0 && (f.detail ?? '').trim() === '' && <p className="text-muted-foreground">No updates logged yet.</p>}
          {(f.logs ?? []).map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="text-muted-foreground w-24 shrink-0 font-mono">{formatDate(l.createdAt)}</span>
              <span className="flex-1">
                {l.kind === 'SNOOZE' && <Chip tone="amber" className="mr-1">snoozed</Chip>}
                {l.kind === 'PROMISE' && <Chip tone="sky" className="mr-1">re-promised {l.newPromisedAt ? formatDate(l.newPromisedAt) : ''}</Chip>}
                {l.kind === 'STATUS' && <Chip tone="emerald" className="mr-1">{l.note}</Chip>}
                {l.stage && <Chip tone="slate" className="mr-1">{l.stage}</Chip>}
                {l.note && l.kind !== 'STATUS' && <span>{l.note}</span>}
                {l.userName && <span className="text-muted-foreground"> — {l.userName}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {logOpen && <LogDialog f={f} onClose={() => setLogOpen(false)} />}
      {doneOpen && <ResolveDialog f={f} onClose={() => setDoneOpen(false)} />}
    </div>
  );
}

/** The closing comment stored on the STATUS log when a follow-up was resolved
 *  ("Resolved — collected in full" → "collected in full"). Returns null when it
 *  was closed without one. */
function resolutionNote(f: FollowupDto): string | null {
  const log = [...(f.logs ?? [])].reverse().find((l) => l.kind === 'STATUS' && (l.note ?? '').startsWith('Resolved'));
  const note = (log?.note ?? '').replace(/^Resolved\s*—\s*/, '').trim();
  return note && note !== 'Resolved' ? note : null;
}

/** "Mark done" — captures an OPTIONAL closing comment (how it was settled) that
 *  lands on the timeline and headlines the Completed card. Enter submits. */
function ResolveDialog({ f, onClose }: { f: FollowupDto; onClose: () => void }) {
  const [note, setNote] = useState('');
  const resolve = useResolveFollowup();
  const submit = () => {
    if (resolve.isPending) return;
    resolve.mutate(
      { id: f.id, note },
      { onSuccess: () => { toast.success('Marked done'); onClose(); }, onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleCheck className="size-5 text-emerald-600" /> Mark as done
          </DialogTitle>
          <DialogDescription>
            “{f.title}” for {f.partyName}. Add a closing comment if it helps — it's optional.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Comment (optional)</Label>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={3}
            placeholder="e.g. collected in full by cheque · settled on call"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-sm outline-none placeholder:text-placeholder focus-visible:ring-[3px]"
          />
          <p className="text-muted-foreground text-[11px]">Saved to this follow-up's timeline. Enter to save, Shift+Enter for a new line.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={resolve.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={resolve.isPending} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {resolve.isPending ? <Loader2 className="animate-spin" /> : <Check />} Mark done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tick-off checklist shown on a board follow-up, with a progress bar. */
function ChecklistProgress({ f, canEdit }: { f: FollowupDto; canEdit: boolean }) {
  const toggle = useUpdateChecklistItem();
  const list = f.checklist ?? [];
  const done = list.filter((c) => c.done).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  return (
    <div className="mt-2 rounded-lg border bg-slate-50/60 p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Checklist</span>
        <span className="text-muted-foreground text-xs tabular-nums">{done}/{list.length}</span>
        <div className="ml-1 h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-blue-500')} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="space-y-1">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-sm">
            <button
              type="button"
              disabled={!canEdit || toggle.isPending}
              onClick={() => toggle.mutate({ itemId: c.id, done: !c.done })}
              className={cn('flex size-5 shrink-0 items-center justify-center rounded border transition-colors', c.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white hover:border-emerald-400')}
              aria-label={c.done ? 'Mark not done' : 'Mark done'}
            >
              {c.done && <Check className="size-3.5" />}
            </button>
            <span className={cn('flex-1', c.done && 'text-muted-foreground line-through')}>{c.text}</span>
            {c.source === 'VOICE' && <Mic className="size-3 shrink-0 text-blue-400" />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Update-log dialog ───────────────────────────────────────────────────────── */

function LogDialog({ f, onClose }: { f: FollowupDto; onClose: () => void }) {
  const addLog = useAddFollowupLog();
  const [note, setNote] = useState('');
  const [stage, setStage] = useState(f.stage ?? '');
  const [newDate, setNewDate] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const isPay = f.kind === 'PAYMENT';

  const submit = () => {
    if (!note.trim() && !stage.trim() && !newDate && !newAmount) return toast.error('Add a note, stage, or a new promise.');
    addLog.mutate(
      { id: f.id, input: { note: note.trim() || null, stage: stage.trim() || null, newPromisedAt: newDate || null, newPromisedAmount: isPay && newAmount.trim() ? Number(newAmount) : null } },
      { onSuccess: () => { toast.success('Update logged'); onClose(); }, onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) },
    );
  };

  useSaveShortcut(submit);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update — {f.title}</DialogTitle>
          <DialogDescription>{f.partyName} · log where it's stuck, change the stage, or re-promise a new date.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">What's the status?</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. delayed at polishing, waiting on Virar supplier…" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Stage</Label>
              <Combobox value={stage} onChange={setStage} options={STAGES} creatable placeholder="Stage…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Re-promise date (optional)</Label>
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            {isPay && (
              <div className="space-y-1">
                <Label className="text-xs">Promised amount ₹ (optional)</Label>
                <Input type="number" min="0" inputMode="numeric" placeholder="0" className="tabular-nums" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={addLog.isPending}>{addLog.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save update</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── New / edit follow-up dialog ─────────────────────────────────────────────
 * Laid out as a data-entry form in a management system, not a consumer app:
 * each question is a titled section with a captioned header and a rule under
 * it, labels are small uppercase captions, money and dates are tabular.
 *
 * Icons are lucide line icons rather than emoji — emoji render differently on
 * every OS, carry a colour we do not control, and sit oddly next to the rest of
 * the app. The big tap targets stay: this is used on a phone on the shop floor.
 */

const STAGE_CHIPS: { v: string; icon: LucideIcon; label: string }[] = [
  { v: 'POLISHING', icon: Sparkles, label: 'Polishing' },
  { v: 'SUPPLIER', icon: Factory, label: 'Supplier' },
  { v: 'DISPATCH', icon: Truck, label: 'Dispatch' },
  { v: 'READY', icon: PackageCheck, label: 'Ready' },
];

const dayShift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const dayName = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
};

/** Small info-icon that shows help text on hover/tap, instead of always-visible hint text. */
function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-full" aria-label="Help">
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-56">{text}</TooltipContent>
    </Tooltip>
  );
}

/** Small uppercase caption above a field — the app's standard form label. */
const CAPTION = 'text-[10.5px] font-bold tracking-[0.09em] text-slate-500 uppercase dark:text-slate-400';

/** One section of the form: a captioned header bar, a rule, then the controls. */
function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card overflow-hidden rounded-md border border-slate-200 dark:border-white/10">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <Icon className="size-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
        <span className={CAPTION}>{title}</span>
        {hint && <HelpTip text={hint} />}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

/** Caption + control, the unit every field in this form is built from. */
function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className={CAPTION}>
        {label}
        {note && <span className="ml-1 font-semibold tracking-normal normal-case opacity-70">{note}</span>}
      </div>
      {children}
    </div>
  );
}

const BIG_FIELD = 'h-11 text-[15px]';

/** Formats the still-open quantity of an order line, e.g. "5 bags, 40 kg".
 *  `toLocaleString` is the app's usual quantity format: thousands grouped, at
 *  most 3 decimals, and no trailing zeros on a whole number. */
const qty = (v: number) => v.toLocaleString('en-IN');
const remLabel = (it: OpenOrderItemHit) => {
  const parts: string[] = [];
  if (it.remBags) parts.push(`${qty(it.remBags)} bag${it.remBags === 1 ? '' : 's'}`);
  if (it.remPcs) parts.push(`${qty(it.remPcs)} pcs`);
  if (it.remGram) parts.push(`${qty(it.remGram)} kg`);
  if (it.remBox) parts.push(`${qty(it.remBox)} box`);
  return parts.join(', ') || 'open';
};
const openItemLabel = (it: OpenOrderItemHit) =>
  `${it.productName || it.design || 'Item'}${it.pCategory ? ` · ${it.pCategory}` : ''} — ${remLabel(it)} (${it.orderCode})`;

/** One editable item row on the follow-up form (quantities kept as strings while typing). */
interface FollowupLineRow {
  key: string;
  productName: string;
  orderItemId: number | null;
  orderCode: string | null;
  bags: string;
  pcs: string;
  kgs: string;
  box: string;
}
const newLineRow = (): FollowupLineRow => ({
  key: Math.random().toString(36).slice(2),
  productName: '',
  orderItemId: null,
  orderCode: null,
  bags: '',
  pcs: '',
  kgs: '',
  box: '',
});

/** Repeatable "item + quantities" editor — a follow-up can cover several order
 *  lines, each with its own bags/pcs/kgs/box to deliver or collect. */
function ItemLinesEditor({
  rows,
  onChange,
  openItems,
  catalog,
}: {
  rows: FollowupLineRow[];
  onChange: (rows: FollowupLineRow[]) => void;
  openItems: OpenOrderItemHit[];
  /** Master-list items, for a follow-up on something with no open order line.
   *  Empty once an order is linked — then only that order's lines make sense. */
  catalog: ComboboxOption[];
}) {
  const options = useMemo(() => [...openItems.map(openItemLabel), ...catalog], [openItems, catalog]);
  const patch = (i: number, p: Partial<FollowupLineRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const pick = (i: number, label: string) => {
    const it = openItems.find((x) => openItemLabel(x) === label);
    patch(i, it ? { productName: label, orderItemId: it.orderItemId, orderCode: it.orderCode } : { productName: label, orderItemId: null, orderCode: null });
  };
  return (
    <div className="space-y-2.5">
      {rows.length === 0 && (
        <p className="text-muted-foreground rounded-lg border border-dashed bg-white/70 px-3 py-4 text-center text-xs">
          No items yet — add each item with how much to deliver or collect.
        </p>
      )}
      {rows.map((r, i) => (
        <div key={r.key} className="space-y-2.5 rounded-xl border bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <Combobox value={r.productName} onChange={(v) => pick(i, v)} options={options} creatable placeholder={catalog.length ? 'Pick an item, or type…' : 'Pick an open item, or type…'} />
            </div>
            <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-rose-50 size-8 shrink-0" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove item">
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(['bags', 'pcs', 'kgs', 'box'] as const).map((k) => (
              <div key={k}>
                <Input inputMode="decimal" className="h-10 text-center text-sm font-medium tabular-nums" value={r[k]} onChange={(e) => patch(i, { [k]: e.target.value } as Partial<FollowupLineRow>)} placeholder="0" />
                <span className="text-muted-foreground mt-1 block text-center text-[10px] font-semibold tracking-wide uppercase">{k}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" className="w-full gap-1.5 border-dashed text-slate-600 hover:border-solid hover:bg-white" onClick={() => onChange([...rows, newLineRow()])}>
        <Plus className="size-4" /> Add item
      </Button>
    </div>
  );
}

function FollowupForm({ kind, editing, prefill, onClose }: { kind: FollowupKind; editing: FollowupDto | null; prefill?: CollectPrefill | null; onClose: () => void }) {
  const create = useCreateFollowup();
  const update = useUpdateFollowup();
  const addChecklist = useAddChecklist();
  const [party, setParty] = useState(editing?.partyName ?? prefill?.party ?? '');
  const [customerId, setCustomerId] = useState<number | null>(editing?.customerId ?? prefill?.customerId ?? null);
  const [partyQuery, setPartyQuery] = useState('');
  const [orderQuery, setOrderQuery] = useState('');
  const [orderId, setOrderId] = useState<number | null>(editing?.orderId ?? null);
  const [orderCode, setOrderCode] = useState(editing?.orderCode ?? '');
  const [orderItemId, setOrderItemId] = useState<number | null>(editing?.orderItemId ?? null);
  const [itemText, setItemText] = useState(editing?.itemText ?? prefill?.itemText ?? '');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [stage, setStage] = useState(editing?.stage ?? '');
  const [priority, setPriority] = useState(editing?.priority ?? 'NORMAL');
  const [promisedAt, setPromisedAt] = useState(editing?.promisedAt?.slice(0, 10) ?? '');
  const [promisedAmount, setPromisedAmount] = useState(editing?.promisedAmount != null ? String(editing.promisedAmount) : prefill?.amount ? String(prefill.amount) : '');
  const [interval, setIntervalMins] = useState(editing?.reminderIntervalMins ? String(editing.reminderIntervalMins) : '');
  const [maxPerDay, setMaxPerDay] = useState(editing?.maxRemindersPerDay != null ? String(editing.maxRemindersPerDay) : '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [description, setDescription] = useState(editing?.detail ?? '');
  const [checklist, setChecklist] = useState<ChecklistDraftItem[]>([]);
  const [lineItems, setLineItems] = useState<FollowupLineRow[]>(() => {
    if (editing?.items?.length) {
      return editing.items.map((it) => ({
        key: `e${it.id}`,
        productName: it.productName ?? '',
        orderItemId: it.orderItemId,
        orderCode: it.orderCode,
        bags: it.bags != null ? String(it.bags) : '',
        pcs: it.pcs != null ? String(it.pcs) : '',
        kgs: it.kgs != null ? String(it.kgs) : '',
        box: it.box != null ? String(it.box) : '',
      }));
    }
    // Back-compat: an older delivery follow-up kept a single itemText — seed it as row 1.
    if (editing && editing.kind !== 'PAYMENT' && (editing.itemText || editing.orderItemId != null)) {
      return [{ ...newLineRow(), productName: editing.itemText ?? '', orderItemId: editing.orderItemId, orderCode: editing.orderCode }];
    }
    return [];
  });

  const { data: parties = [] } = usePartySuggest(partyQuery);
  // With a party picked, this lists THEIR open orders (pending lines > 0) directly.
  const { data: orders = [] } = useOrderSuggest(orderQuery, party || undefined);
  // …and this lists their actual open order LINE ITEMS, so a delivery can be linked precisely.
  const { data: openItems = [] } = useOrderItemSuggest(customerId, party);
  const { data: lookups } = useOrderLookups();

  const onPickParty = (v: string) => {
    setParty(v);
    const match = parties.find((p) => p.partyName === v);
    setCustomerId(match?.id ?? null);
  };
  const orderOptions = useMemo(
    () =>
      orders.map((o) => ({
        value: o.code,
        label: party
          ? `${o.code} · ${o.pendingLines} line${o.pendingLines === 1 ? '' : 's'} open`
          : `${o.code} · ${o.customerName} · ${o.pendingLines} open`,
      })),
    [orders, party],
  );
  const onPickOrder = (code: string) => {
    const o = orders.find((x) => x.code === code);
    setOrderCode(code);
    setOrderId(o?.id ?? null);
    if (o && !party) { setParty(o.customerName); setCustomerId(o.customerId ?? null); }
    // Drop a previously-picked item that isn't part of the newly linked order.
    if (o && orderItemId != null) {
      const cur = openItems.find((it) => it.orderItemId === orderItemId);
      if (cur && cur.orderId !== o.id) { setItemText(''); setOrderItemId(null); }
    }
  };

  // Once an order is linked, the item picker narrows to JUST that order's open
  // lines; with no order linked it lists all of the party's open lines.
  const itemPool = useMemo(() => (orderId ? openItems.filter((it) => it.orderId === orderId) : openItems), [openItems, orderId]);

  /**
   * The product master, named the way the order form names an item
   * ("10 RDX · GLASS") so the list reads the same whether a row came from an
   * open order line or was added by hand. Only offered when NO order is linked:
   * once one is, the only sensible items are that order's own open lines.
   *
   * A follow-up item stores just a product NAME (see `FollowupItem`), so this
   * fills that one field rather than carrying category/design separately.
   */
  const catalogOptions = useMemo<ComboboxOption[]>(() => {
    if (orderId) return [];
    const seen = new Set<string>();
    const out: ComboboxOption[] = [];
    for (const it of lookups?.items ?? []) {
      const name = [it.size == null ? '' : String(it.size), it.product, it.designType ?? ''].filter(Boolean).join(' ');
      if (!name) continue;
      const label = it.category ? `${name} · ${it.category}` : name;
      if (seen.has(label)) continue;
      seen.add(label);
      // Findable by pcs / sub-category too, exactly like the order form's picker.
      out.push({ value: label, label, keywords: [it.pcs == null ? '' : String(it.pcs), it.subCategory ?? ''].filter(Boolean).join(' ') });
    }
    return out;
  }, [lookups, orderId]);

  const isPay = kind === 'PAYMENT';
  const isInquiry = kind === 'INQUIRY';

  const submit = () => {
    if (!party.trim()) return toast.error('Choose or type the party first.');
    const numOrNull = (v: string) => {
      const t = v.trim();
      if (!t) return null;
      const nx = Number(t);
      return Number.isFinite(nx) ? nx : null;
    };
    const items = lineItems
      .filter((r) => r.productName.trim() || r.bags || r.pcs || r.kgs || r.box)
      .map((r) => ({
        productName: r.productName.trim() || null,
        orderItemId: r.orderItemId,
        orderCode: r.orderCode,
        bags: numOrNull(r.bags),
        pcs: numOrNull(r.pcs),
        kgs: numOrNull(r.kgs),
        box: numOrNull(r.box),
      }));
    // Less typing: when no title was written, build one from what we know.
    const firstItem = items.find((it) => it.productName)?.productName ?? null;
    const autoTitle =
      title.trim() ||
      (isPay && itemText.trim() ? `Collect ${itemText.trim()}` : '') ||
      (!isPay && firstItem ? `Deliver ${firstItem}${items.length > 1 ? ` +${items.length - 1} more` : ''}` : '') ||
      (orderCode ? `${isPay ? 'Payment for' : 'Deliver'} ${orderCode}` : '') ||
      (isPay ? 'Payment follow-up' : 'Delivery follow-up');
    const input = {
      kind, customerId, partyName: party.trim(), orderId, orderCode: orderCode || null, orderItemId,
      itemText: isPay ? itemText.trim() || null : null,
      title: autoTitle, detail: description.trim() || null, stage: stage.trim() || null, priority: priority as 'NORMAL' | 'URGENT',
      promisedAt: promisedAt || null,
      promisedAmount: isPay && promisedAmount.trim() ? Number(promisedAmount) : null,
      reminderIntervalMins: interval.trim() ? Number(interval) : null,
      maxRemindersPerDay: maxPerDay.trim() ? Number(maxPerDay) : null,
      items,
      ...(editing ? {} : { checklist: checklist.map((c) => ({ text: c.text, source: 'MANUAL' as const })) }),
    };
    const onDone = () => { toast.success(editing ? 'Follow-up updated' : 'Follow-up added'); onClose(); };
    const onFail = (e: unknown) => toast.error(getApiErrorMessage(e, 'Failed'));
    if (editing) {
      update.mutate(
        { id: editing.id, input },
        {
          onSuccess: () => {
            if (checklist.length > 0) addChecklist.mutate({ id: editing.id, items: checklist.map((c) => ({ text: c.text, source: 'MANUAL' })) });
            onDone();
          },
          onError: onFail,
        },
      );
    } else {
      create.mutate(input, { onSuccess: onDone, onError: onFail });
    }
  };

  useSaveShortcut(submit);

  const saving = create.isPending || update.isPending;
  const dateChips = [
    { label: `Today`, v: dayShift(0) },
    { label: `Tomorrow`, v: dayShift(1) },
    { label: dayName(2), v: dayShift(2) },
    { label: dayName(3), v: dayShift(3) },
  ];

  // ── Shared field fragments (reused by the payment + delivery layouts) ──
  const dateChipRow = (
    <div className="flex flex-wrap items-center gap-2">
      {dateChips.map((c) => (
        <button
          key={c.v}
          type="button"
          onClick={() => setPromisedAt(promisedAt === c.v ? '' : c.v)}
          className={cn(
            'h-11 cursor-pointer rounded-md border px-3.5 text-sm font-semibold transition-colors',
            promisedAt === c.v
              ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
              : 'bg-card border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5',
          )}
        >
          {c.label}
        </button>
      ))}
      <Input type="date" className="h-11 w-full flex-1 basis-36 text-sm tabular-nums" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />
    </div>
  );

  const notesField = (
    <textarea
      value={description}
      onChange={(e) => setDescription(e.target.value)}
      rows={Math.min(8, Math.max(2, description.split('\n').length + 1))}
      placeholder="What was discussed, agreed or promised."
      className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-[15px] outline-none placeholder:text-placeholder focus-visible:ring-[3px]"
    />
  );

  /* A segmented control rather than two loose buttons: priority is one value with
   * two states, and a joined pair says that better than two independent chips. */
  const urgencyButtons = (
    <div className="inline-flex w-full overflow-hidden rounded-md border border-slate-300 dark:border-white/15">
      <button
        type="button"
        onClick={() => setPriority('NORMAL')}
        className={cn(
          'h-11 flex-1 cursor-pointer text-sm font-semibold transition-colors',
          priority === 'NORMAL'
            ? 'bg-slate-700 text-white dark:bg-slate-600'
            : 'bg-card text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5',
        )}
      >
        Normal
      </button>
      <button
        type="button"
        onClick={() => setPriority('URGENT')}
        className={cn(
          'inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 border-l border-slate-300 text-sm font-semibold transition-colors dark:border-white/15',
          priority === 'URGENT'
            ? 'bg-rose-600 text-white'
            : 'bg-card text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10',
        )}
      >
        <TriangleAlert className="size-4" /> Urgent
      </button>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-slate-200 py-3 pr-12 pl-4 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {isPay ? <HandCoins className="size-4" /> : isInquiry ? <MessageSquarePlus className="size-4" /> : <Handshake className="size-4" />}
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base leading-tight font-semibold">
                {editing ? 'Edit follow-up' : isPay ? 'New payment follow-up' : isInquiry ? 'New inquiry' : 'New follow-up'}
              </DialogTitle>
              <p className="text-muted-foreground mt-0.5 text-[11.5px]">
                Only the party is required. Everything else can be filled in later.
              </p>
            </div>
          </div>
          <DialogDescription className="sr-only">Fill what you know — only the party is a must. The system will remember and remind.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-2.5 overflow-y-auto bg-slate-50/70 p-3 dark:bg-white/[0.02]">
          {/* 1 · WHO */}
          <Section icon={Building2} title="Party" hint="Search a customer, or just type any name. Linking one of their open orders is optional.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Party name">
                <Combobox value={party} onChange={onPickParty} onType={setPartyQuery} options={parties.map((p) => p.partyName)} creatable placeholder="Type the party name…" className={BIG_FIELD} />
              </Field>
              <Field label="Linked order" note="(optional)">
                <Combobox value={orderCode} onChange={onPickOrder} onType={setOrderQuery} options={orderOptions} placeholder={party ? 'Their open orders — tap to pick' : 'Order number'} className={BIG_FIELD} />
              </Field>
            </div>
          </Section>

          {isPay ? (
            /* ── Payment layout: money → date → what-for → notes → urgency ── */
            <>
              <Section icon={Wallet} title="Payment commitment" hint="Pick from the balance below, then set the promised amount and date.">
                <div className="space-y-4">
                  {(party.trim() || customerId != null) && (
                    <PartyBalancePanel
                      customerId={customerId}
                      party={party}
                      onPickAmount={(amount, label) => { setPromisedAmount(String(amount)); if (!itemText.trim()) setItemText(`${label} to collect`); }}
                      onPickInvoice={(code, bal) => { setPromisedAmount(String(bal)); setItemText(`${inrFull(bal)} for ${code}`); }}
                    />
                  )}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Promised amount">
                      <div className="relative">
                        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[15px] text-slate-500">₹</span>
                        <Input type="number" min="0" inputMode="numeric" placeholder="0" className={cn(BIG_FIELD, 'pl-8 font-semibold tabular-nums')} value={promisedAmount} onChange={(e) => setPromisedAmount(e.target.value)} />
                      </div>
                    </Field>
                    <Field label="Promised by">{dateChipRow}</Field>
                  </div>
                  <Field label="Against" note="(optional)">
                    <Input className={BIG_FIELD} value={itemText} onChange={(e) => setItemText(e.target.value)} placeholder="e.g. balance for challan 210" />
                  </Field>
                </div>
              </Section>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_auto]">
                <Section icon={MessageSquare} title="Remarks" hint="What was discussed — one line or many.">
                  {notesField}
                </Section>
                <Section icon={Flag} title="Priority">
                  <div className="sm:w-56">{urgencyButtons}</div>
                </Section>
              </div>
            </>
          ) : (
            /* ── Delivery layout: items → notes → checklist → when → stage + urgency ── */
            <>
              <Section icon={Package} title="Items & quantities" hint="Add each item on this follow-up with how much to deliver.">
                <ItemLinesEditor rows={lineItems} onChange={setLineItems} openItems={itemPool} catalog={catalogOptions} />
              </Section>

              <Section icon={MessageSquare} title="Remarks" hint="Any details or discussion — one line or many.">
                {notesField}
              </Section>

              <Section icon={ListChecks} title="Checklist" hint={editing ? 'Add new tasks — existing ones stay editable on the board.' : 'Optional — break the promise into sub-tasks.'}>
                <ChecklistInput items={checklist} onChange={setChecklist} />
              </Section>

              <Section icon={CalendarDays} title="Promised date" hint="Tap a day, or pick a date.">
                {dateChipRow}
              </Section>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Section icon={Factory} title="Current stage" hint="Optional — where the work has reached.">
                  <div className="flex flex-wrap gap-2">
                    {STAGE_CHIPS.map((s) => {
                      const Icon = s.icon;
                      const on = stage === s.v;
                      return (
                        <button
                          key={s.v}
                          type="button"
                          onClick={() => setStage(on ? '' : s.v)}
                          className={cn(
                            'inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
                            on
                              ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                              : 'bg-card border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5',
                          )}
                        >
                          <Icon className="size-3.5" /> {s.label}
                        </button>
                      );
                    })}
                  </div>
                </Section>
                <Section icon={Flag} title="Priority">
                  {urgencyButtons}
                </Section>
              </div>
            </>
          )}

          {/* 5 · optional title + reminder overrides, tucked away */}
          <section className="bg-card overflow-hidden rounded-md border border-slate-200 dark:border-white/10">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/[0.04]"
            >
              <SlidersHorizontal className="size-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
              <span className={CAPTION}>Advanced</span>
              <span className="text-muted-foreground text-[11.5px]">Title, reminder frequency</span>
              <ChevronDown className={cn('text-muted-foreground ml-auto size-4 transition-transform', showAdvanced && 'rotate-180')} />
            </button>
            {showAdvanced && (
              <div className="space-y-3 border-t border-slate-200 p-3 dark:border-white/10">
                <Field label="Title" note="(auto-written if left empty)">
                  <Input className={BIG_FIELD} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Deliver 10 MALBORO by Wed" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Remind every" note="(minutes)">
                    <Input className={cn(BIG_FIELD, 'tabular-nums')} type="number" min="1" value={interval} onChange={(e) => setIntervalMins(e.target.value)} placeholder="use default" />
                  </Field>
                  <Field label="Max reminders / day">
                    <Input className={cn(BIG_FIELD, 'tabular-nums')} type="number" min="0" value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} placeholder="0 = unlimited" />
                  </Field>
                </div>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="gap-2 border-t border-slate-200 px-4 py-3 sm:gap-2 dark:border-white/10">
          <Button variant="outline" className="h-11 px-6" onClick={onClose}>Cancel</Button>
          <Button className="h-11 flex-1 font-semibold sm:flex-none sm:px-10" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />} {editing ? 'Save changes' : 'Save follow-up'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FollowupsPage;
export function PaymentsFollowupsPage() {
  return <FollowupsPage kind="PAYMENT" />;
}

/**
 * New Inquiries (spec §12.2).
 *
 * An enquiry is a promise you owe a party — it has a party, a thing they asked
 * about, a date you said you would come back to them, and it must keep nudging
 * until it becomes an order or is closed. That is precisely a follow-up, so it
 * reuses the whole machinery (reminders, timeline, checklist, party links)
 * under its own kind rather than duplicating it as a parallel model.
 */
export function InquiriesPage() {
  return <FollowupsPage kind="INQUIRY" />;
}
