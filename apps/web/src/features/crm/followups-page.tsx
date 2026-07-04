import { useMemo, useState } from 'react';
import { AlarmClock, Bell, CalendarClock, Check, ChevronDown, CircleCheck, Clock, Loader2, Mic, Pencil, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { type FollowupDto, type FollowupKind, type FollowupPartyGroup } from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { Combobox } from '@/components/ui/combobox';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useAddFollowupLog,
  useCreateFollowup,
  useDeleteFollowup,
  useFollowupBoard,
  useFollowupSummary,
  useOrderSuggest,
  usePartySuggest,
  useResolveFollowup,
  useSnoozeFollowup,
  useUpdateChecklistItem,
  useUpdateFollowup,
} from './use-crm';
import { Chip, initials, itemLine, UrgencyChip } from './crm-shared';
import { VoiceCapture } from './voice-capture';
import { VoiceResolveDialog, type ResolveAnswer, type ResolveField } from './voice-resolve';

type PartyHit = { id: number | null; partyName: string };
type ProductHit = { id: number; name: string; category: string; subCategory: string };
/** A catalogue item shown as "ROYAL · GLASS" so the category disambiguates. */
const itemLabel = (p: ProductHit) => (p.category ? `${p.name} · ${p.category}` : p.name);

const STAGES = ['POLISHING', 'SUPPLIER', 'DISPATCH', 'READY'];
const BUCKETS = [
  { v: '', label: 'All open' },
  { v: 'attention', label: 'Needs attention' },
  { v: 'overdue', label: 'Overdue' },
  { v: 'today', label: 'Due today' },
  { v: 'upcoming', label: 'Upcoming' },
];

export function FollowupsPage({ kind = 'DELIVERY' }: { kind?: FollowupKind }) {
  const { can } = usePermissions();
  const canEdit = can('crm:update') || can('crm:create');
  const [bucket, setBucket] = useState('');
  const [search, setSearch] = useState('');
  const query = useMemo(() => ({ kind, bucket: bucket || undefined, search: search || undefined }), [kind, bucket, search]);
  const { data: groups = [], isLoading } = useFollowupBoard(query);
  const { data: summary } = useFollowupSummary(kind);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FollowupDto | null>(null);

  const isPay = kind === 'PAYMENT';
  const openForm = (f: FollowupDto | null) => { setEditing(f); setFormOpen(true); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          {isPay ? <CalendarClock className="size-5" /> : <Bell className="size-5" />}
        </div>
        <div className="mr-auto">
          <h2 className="text-2xl font-semibold tracking-tight">{isPay ? 'Payment Follow-ups' : 'Follow-ups'}</h2>
          <p className="text-muted-foreground text-sm">Every promise to a party, tracked until it's done — the system keeps nudging.</p>
        </div>
        {canEdit && (
          <Button onClick={() => openForm(null)}>
            <Plus /> New follow-up
          </Button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Overdue" value={summary?.overdue ?? 0} tone="rose" icon={<TriangleAlert className="size-4" />} active={bucket === 'overdue'} onClick={() => setBucket(bucket === 'overdue' ? '' : 'overdue')} />
        <Kpi label="Due today" value={summary?.dueToday ?? 0} tone="amber" icon={<Clock className="size-4" />} active={bucket === 'today'} onClick={() => setBucket(bucket === 'today' ? '' : 'today')} />
        <Kpi label="Nudging now" value={summary?.activeNudges ?? 0} tone="violet" icon={<AlarmClock className="size-4" />} active={bucket === 'attention'} onClick={() => setBucket(bucket === 'attention' ? '' : 'attention')} />
        <Kpi label="Open total" value={summary?.openTotal ?? 0} tone="sky" icon={<Bell className="size-4" />} active={bucket === ''} onClick={() => setBucket('')} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search party, title, order…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-48">
          <NativeSelect value={bucket} onChange={setBucket} options={BUCKETS.map((b) => b.v)} renderOption={(v) => <span>{BUCKETS.find((b) => b.v === v)?.label ?? 'All open'}</span>} placeholder="All open" />
        </div>
      </div>

      {/* Party-wise board */}
      {isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm"><Loader2 className="size-4 animate-spin" /> Loading follow-ups…</div>
      ) : groups.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-12 text-center text-sm">
          <CircleCheck className="text-emerald-400 mx-auto mb-3 size-10" />
          Nothing pending here. {canEdit && 'Log a new commitment with “New follow-up”.'}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((g) => <PartyCard key={g.partyName} group={g} canEdit={canEdit} onEdit={openForm} />)}
        </div>
      )}

      {formOpen && <FollowupForm kind={kind} editing={editing} onClose={() => setFormOpen(false)} />}
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

function PartyCard({ group, canEdit, onEdit }: { group: FollowupPartyGroup; canEdit: boolean; onEdit: (f: FollowupDto) => void }) {
  return (
    <section className="bg-card overflow-hidden rounded-xl border shadow-sm">
      <div className="flex items-center gap-2 border-b bg-gradient-to-r from-slate-50 to-transparent px-3 py-2.5">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">{initials(group.partyName)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{group.partyName}</div>
          <div className="text-muted-foreground text-xs">{group.openCount} open{group.nextPromiseAt ? ` · next ${formatDate(group.nextPromiseAt)}` : ''}</div>
        </div>
        {group.overdueCount > 0 && <Chip tone="rose">{group.overdueCount} overdue</Chip>}
        {group.activeNudges > 0 && <Chip tone="violet"><AlarmClock className="size-3" /> {group.activeNudges}</Chip>}
      </div>
      <div className="divide-y">
        {group.items.map((f) => <FollowupRow key={f.id} f={f} canEdit={canEdit} onEdit={onEdit} />)}
      </div>
    </section>
  );
}

function FollowupRow({ f, canEdit, onEdit }: { f: FollowupDto; canEdit: boolean; onEdit: (f: FollowupDto) => void }) {
  const [open, setOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const confirm = useConfirm();
  const snooze = useSnoozeFollowup();
  const resolve = useResolveFollowup();
  const del = useDeleteFollowup();
  const { can } = usePermissions();
  const line = itemLine(f);

  const doResolve = async () => {
    resolve.mutate(f.id, { onSuccess: () => toast.success('Marked done'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) });
  };
  const doDelete = async () => {
    if (!(await confirm({ title: 'Delete this follow-up?', description: `“${f.title}” for ${f.partyName} will be removed.`, confirmText: 'Delete', destructive: true }))) return;
    del.mutate(f.id, { onSuccess: () => toast.success('Deleted'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) });
  };

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {f.priority === 'URGENT' && <Chip tone="rose">URGENT</Chip>}
            <span className="font-medium">{f.title}</span>
            {f.stage && <Chip tone="slate">{f.stage}</Chip>}
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <UrgencyChip f={f} />
            {line && <span className="font-mono">{line}</span>}
            {f.detail && <span className="truncate">· {f.detail}</span>}
          </div>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1" aria-label="Timeline">
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {/* Checklist — tick tasks off as they're finished */}
      {(f.checklist ?? []).length > 0 && <ChecklistProgress f={f} canEdit={canEdit} />}

      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLogOpen(true)}><Pencil className="size-3" /> Update</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs text-amber-700" onClick={() => snooze.mutate(f.id, { onSuccess: () => toast.success('Snoozed — will nudge again later'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) })} disabled={snooze.isPending}>
            <AlarmClock className="size-3" /> Snooze
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-700" onClick={doResolve} disabled={resolve.isPending}><Check className="size-3" /> Done</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(f)}><Pencil className="size-3" /> Edit</Button>
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
    </div>
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

  const submit = () => {
    if (!note.trim() && !stage.trim() && !newDate) return toast.error('Add a note, stage, or a new promised date.');
    addLog.mutate(
      { id: f.id, input: { note: note.trim() || null, stage: stage.trim() || null, newPromisedAt: newDate || null } },
      { onSuccess: () => { toast.success('Update logged'); onClose(); }, onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) },
    );
  };

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
 * Designed to be usable at a glance: big touch targets, one question per block,
 * emoji-guided choices and tap-chips instead of typing wherever possible. */

const STAGE_CHIPS: { v: string; emoji: string; label: string }[] = [
  { v: 'POLISHING', emoji: '✨', label: 'Polishing' },
  { v: 'SUPPLIER', emoji: '🏭', label: 'Supplier' },
  { v: 'DISPATCH', emoji: '🚚', label: 'Dispatch' },
  { v: 'READY', emoji: '✅', label: 'Ready' },
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

/** One question-block of the form: a big icon + heading, then the control. */
function Block({ emoji, title, hint, children }: { emoji: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-slate-50/60 p-3.5 sm:p-4">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-lg shadow-sm ring-1 ring-slate-200">{emoji}</span>
        <div>
          <div className="text-[15px] font-semibold leading-tight">{title}</div>
          {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

const BIG_FIELD = 'h-12 text-base';

function FollowupForm({ kind, editing, onClose }: { kind: FollowupKind; editing: FollowupDto | null; onClose: () => void }) {
  const create = useCreateFollowup();
  const update = useUpdateFollowup();
  const [party, setParty] = useState(editing?.partyName ?? '');
  const [customerId, setCustomerId] = useState<number | null>(editing?.customerId ?? null);
  const [partyQuery, setPartyQuery] = useState('');
  const [orderQuery, setOrderQuery] = useState('');
  const [orderId, setOrderId] = useState<number | null>(editing?.orderId ?? null);
  const [orderCode, setOrderCode] = useState(editing?.orderCode ?? '');
  const [itemText, setItemText] = useState(editing?.itemText ?? '');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [stage, setStage] = useState(editing?.stage ?? '');
  const [priority, setPriority] = useState(editing?.priority ?? 'NORMAL');
  const [promisedAt, setPromisedAt] = useState(editing?.promisedAt?.slice(0, 10) ?? '');
  const [interval, setIntervalMins] = useState(editing?.reminderIntervalMins ? String(editing.reminderIntervalMins) : '');
  const [maxPerDay, setMaxPerDay] = useState(editing?.maxRemindersPerDay != null ? String(editing.maxRemindersPerDay) : '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Description / notes — a 1-line or multi-line message; the mic summarises speech into it.
  const [description, setDescription] = useState(editing?.detail ?? '');

  const { data: parties = [] } = usePartySuggest(partyQuery);
  // With a party picked, this lists THEIR open orders (pending lines > 0) directly.
  const { data: orders = [] } = useOrderSuggest(orderQuery, party || undefined);

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
  };

  // Voice fields (customer/item) that matched >1 list entry → ask the user.
  const [resolve, setResolve] = useState<ResolveField[] | null>(null);

  const applyCustomer = (name: string, id: number | null) => { setParty(name); setCustomerId(id); };

  /**
   * Match a spoken customer against the customer list and a spoken item against
   * the product catalogue. Exact or single match → fill it silently; several
   * matches → collect a question; none → keep what was said. Any collected
   * questions open the "Just to be sure…" dialog.
   */
  const handleVoiceResult = async (result: { detectedCustomer?: string; detectedItem?: string }) => {
    const customer = result.detectedCustomer?.trim();
    const item = result.detectedItem?.trim();
    const questions: ResolveField[] = [];

    if (customer) {
      const hits = await http
        .get<PartyHit[]>('/crm/followups/party-match', { params: { q: customer } })
        .catch(() => [] as PartyHit[]);
      const exact = hits.find((h) => h.partyName.toLowerCase() === customer.toLowerCase());
      if (exact) { applyCustomer(exact.partyName, exact.id); toast.success(`Party matched: ${exact.partyName}`); }
      else if (hits.length === 1) { applyCustomer(hits[0].partyName, hits[0].id); toast.success(`Party matched: ${hits[0].partyName}`); }
      else if (hits.length > 1) { questions.push({ kind: 'customer', spoken: customer, candidates: hits.map((h) => ({ id: h.id, label: h.partyName })) }); }
      else { applyCustomer(customer, null); toast.info(`New party noted: ${customer}`); }
    }

    if (item) {
      const hits = await http
        .get<ProductHit[]>('/crm/followups/product-suggest', { params: { q: item } })
        .catch(() => [] as ProductHit[]);
      const exact = hits.find((h) => h.name.toLowerCase() === item.toLowerCase());
      if (exact) { setItemText(itemLabel(exact)); toast.success(`Item matched: ${exact.name}`); }
      else if (hits.length === 1) { setItemText(itemLabel(hits[0])); toast.success(`Item matched: ${hits[0].name}`); }
      else if (hits.length > 1) { questions.push({ kind: 'item', spoken: item, candidates: hits.map((h) => ({ id: h.id, label: itemLabel(h) })) }); }
      else { setItemText(item); toast.info(`Item noted: ${item}`); }
    }

    if (questions.length > 0) setResolve(questions);
  };

  const applyResolved = (answers: ResolveAnswer[]) => {
    for (const a of answers) {
      if (a.kind === 'customer') applyCustomer(a.label, a.id);
      else setItemText(a.label);
    }
    setResolve(null);
    toast.success('Updated from your voice');
  };

  const isPay = kind === 'PAYMENT';
  const submit = () => {
    if (!party.trim()) return toast.error('Choose or type the party first.');
    // Less typing: when no title was written, build one from what we know.
    const autoTitle =
      title.trim() ||
      (itemText.trim() ? `${isPay ? 'Collect' : 'Deliver'} ${itemText.trim()}` : '') ||
      (orderCode ? `${isPay ? 'Payment for' : 'Deliver'} ${orderCode}` : '') ||
      (isPay ? 'Payment follow-up' : 'Delivery follow-up');
    const input = {
      kind, customerId, partyName: party.trim(), orderId, orderCode: orderCode || null, itemText: itemText.trim() || null,
      title: autoTitle, detail: description.trim() || null, stage: stage.trim() || null, priority: priority as 'NORMAL' | 'URGENT',
      promisedAt: promisedAt || null,
      reminderIntervalMins: interval.trim() ? Number(interval) : null,
      maxRemindersPerDay: maxPerDay.trim() ? Number(maxPerDay) : null,
    };
    const opts = { onSuccess: () => { toast.success(editing ? 'Follow-up updated' : 'Follow-up added'); onClose(); }, onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Failed')) };
    if (editing) update.mutate({ id: editing.id, input }, opts);
    else create.mutate(input, opts);
  };

  const saving = create.isPending || update.isPending;
  const dateChips = [
    { label: `Today`, v: dayShift(0) },
    { label: `Tomorrow`, v: dayShift(1) },
    { label: dayName(2), v: dayShift(2) },
    { label: dayName(3), v: dayShift(3) },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{editing ? 'Edit follow-up' : isPay ? 'New payment follow-up' : 'New follow-up'}</DialogTitle>
          <DialogDescription className="text-sm">
            Fill what you know — only the <b>party</b> is a must. The system will remember and remind.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[64vh] space-y-3 overflow-y-auto px-1 pb-1">
          {/* 1 · WHO */}
          <Block emoji="👤" title="Which party?" hint="Search a customer, or just type any name.">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Combobox value={party} onChange={onPickParty} onType={setPartyQuery} options={parties.map((p) => p.partyName)} creatable placeholder="Type the party name…" className={BIG_FIELD} />
              <Combobox value={orderCode} onChange={onPickOrder} onType={setOrderQuery} options={orderOptions} placeholder={party ? '🔗 Their open orders — tap to pick' : '🔗 Link an open order # (optional)'} className={BIG_FIELD} />
            </div>
          </Block>

          {/* 2 · WHAT — item + a description you can type OR speak (one mic) */}
          <Block emoji={isPay ? '💰' : '📦'} title={isPay ? 'What payment & notes' : 'What they asked for & notes'} hint="Type it, or tap the mic and just talk — it summarises into the note.">
            <div className="space-y-4">
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">{isPay ? 'Payment' : 'Item'}</div>
                <Input className={BIG_FIELD} value={itemText} onChange={(e) => setItemText(e.target.value)} placeholder={isPay ? 'e.g. ₹1,20,000 balance for challan 210' : 'e.g. 10 MALBORO — 5 bags'} autoFocus={!editing} />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">💬 Description / notes</span>
                </div>
                <VoiceCapture onConfirm={(t) => setDescription((d) => (d.trim() ? `${d.trim()}\n${t}` : t))} onVoiceResult={handleVoiceResult} />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={Math.min(8, Math.max(2, description.split('\n').length + 1))}
                  placeholder="Type the note here — one line or many. Or use the mic above."
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 mt-2 w-full rounded-md border px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-[3px]"
                />
              </div>
            </div>
          </Block>

          {/* 3 · WHEN */}
          <Block emoji="📅" title="Promised by when?" hint="Tap a day, or pick a date.">
            <div className="flex flex-wrap items-center gap-2">
              {dateChips.map((c) => (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => setPromisedAt(promisedAt === c.v ? '' : c.v)}
                  className={cn(
                    'h-11 rounded-lg border px-4 text-[15px] font-semibold transition-colors',
                    promisedAt === c.v ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50',
                  )}
                >
                  {c.label}
                </button>
              ))}
              <Input type="date" className="h-11 w-44 text-[15px]" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />
            </div>
          </Block>

          {/* 4 · WHERE / HOW URGENT */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Block emoji="🏭" title="Where is it now?" hint="Optional — tap one.">
              <div className="flex flex-wrap gap-2">
                {STAGE_CHIPS.map((s) => (
                  <button
                    key={s.v}
                    type="button"
                    onClick={() => setStage(stage === s.v ? '' : s.v)}
                    className={cn(
                      'inline-flex h-11 items-center gap-1.5 rounded-lg border px-3 text-[15px] font-medium transition-colors',
                      stage === s.v ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50',
                    )}
                  >
                    <span>{s.emoji}</span> {s.label}
                  </button>
                ))}
              </div>
            </Block>
            <Block emoji="⚡" title="How urgent?">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPriority('NORMAL')}
                  className={cn(
                    'h-12 rounded-lg border text-[15px] font-semibold transition-colors',
                    priority === 'NORMAL' ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm' : 'bg-white text-slate-700 hover:bg-emerald-50',
                  )}
                >
                  🙂 Normal
                </button>
                <button
                  type="button"
                  onClick={() => setPriority('URGENT')}
                  className={cn(
                    'h-12 rounded-lg border text-[15px] font-semibold transition-colors',
                    priority === 'URGENT' ? 'border-rose-600 bg-rose-600 text-white shadow-sm' : 'bg-white text-slate-700 hover:bg-rose-50',
                  )}
                >
                  🔥 Urgent
                </button>
              </div>
            </Block>
          </div>

          {/* 5 · optional title + reminder overrides, tucked away */}
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-1 text-sm font-medium">
            <ChevronDown className={cn('size-4 transition-transform', showAdvanced && 'rotate-180')} /> More options (title, reminder frequency)
          </button>
          {showAdvanced && (
            <div className="space-y-3 rounded-xl border bg-slate-50/60 p-4">
              <div className="space-y-1">
                <Label className="text-xs">Title (auto-written if left empty)</Label>
                <Input className="h-11" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Deliver 10 MALBORO by Wed" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Remind every (mins)</Label>
                  <Input className="h-11" type="number" min="1" value={interval} onChange={(e) => setIntervalMins(e.target.value)} placeholder="use default" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max reminders / day</Label>
                  <Input className="h-11" type="number" min="0" value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} placeholder="0 = unlimited" />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="h-12 px-6 text-base" onClick={onClose}>Cancel</Button>
          <Button className="h-12 flex-1 text-base font-semibold sm:flex-none sm:px-10" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />} {editing ? 'Save changes' : 'Save follow-up'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {resolve && (
        <VoiceResolveDialog fields={resolve} onCancel={() => setResolve(null)} onResolve={applyResolved} />
      )}
    </Dialog>
  );
}

export default FollowupsPage;
export function PaymentsFollowupsPage() {
  return <FollowupsPage kind="PAYMENT" />;
}
