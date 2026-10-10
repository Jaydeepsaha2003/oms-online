import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Bug, ChevronDown, ChevronUp, ChevronsUp, CircleCheck, Equal, FileText, Flame, Inbox, ListTodo, Loader2, Lock,
  MessageSquare, Paperclip, Plus, RotateCcw, Search, Send, Upload, UserRound, X, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskApp, type TaskDetailDto, type TaskEventDto, type TaskFileDto, type TaskPersonDto, type TaskPriority, type TaskStatus, type TaskSummaryDto, type TaskType } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  downloadTaskFile, useAddTaskFiles, useCompleteTask, useCreateTask, useRemoveTaskFile, useReopenTask, useSendComment, useTask, useTaskList, useUpdateTask,
} from './use-tasks';

type Tab = 'active' | TaskStatus | 'all';
const TABS: Tab[] = ['active', 'open', 'in_progress', 'in_review', 'done', 'all'];
const TAB_LABEL: Record<Tab, string> = { active: 'Active', open: 'Open', in_progress: 'In progress', in_review: 'In review', done: 'Done', all: 'All' };
const STATUS_LABEL: Record<TaskStatus, string> = { open: 'Open', in_progress: 'In progress', in_review: 'In review', done: 'Done' };
const STATUS_TONE: Record<TaskStatus, string> = {
  open: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  in_review: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
};
const PRIO: Record<TaskPriority, { label: string; icon: LucideIcon; tone: string; hint: string }> = {
  critical: { label: 'Critical', icon: ChevronsUp, tone: 'text-red-600', hint: 'Work is stopped' },
  high: { label: 'High', icon: ChevronUp, tone: 'text-orange-600', hint: 'Needed soon' },
  medium: { label: 'Medium', icon: Equal, tone: 'text-blue-600', hint: 'Normal pace' },
  low: { label: 'Low', icon: ChevronDown, tone: 'text-slate-500', hint: 'Whenever there is time' },
};
const PRIO_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SELECT = 'border-input bg-background h-9 w-full rounded-md border px-2 text-sm';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, n] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
  return 'just now';
}
const when = (iso: string | null | undefined) => (iso ? `${formatDate(iso)} ${new Date(iso).toTimeString().slice(0, 5)}` : '');
const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);
const isImage = (f: { name: string; mimeType?: string; type?: string }) => (f.mimeType || f.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
const initials = (name?: string) => (name ?? '?').split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
const tooBig = (files: File[]) => {
  const ok = files.filter((f) => f.size <= MAX_FILE_BYTES);
  if (ok.length < files.length) toast.error('Files can be at most 25 MB.');
  return ok;
};
const fail = (e: unknown) => toast.error(getApiErrorMessage(e, 'Could not save'));

function Avatar({ person, className }: { person?: TaskPersonDto | null; className?: string }) {
  return (
    <span title={person?.name} className={cn('bg-gradient-brand inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', className)}>
      {initials(person?.name)}
    </span>
  );
}

function StatusChip({ status }: { status: TaskStatus }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>;
}

function TypeIcon({ type, className }: { type: TaskType; className?: string }) {
  return type === 'bug' ? <Bug className={cn('size-4 text-red-600', className)} /> : <CircleCheck className={cn('size-4 text-blue-600', className)} />;
}

/** Tasks & Bugs, shared by OMS and WMS. `app` is the app this page is in: new
 *  ones are filed under it, and the list starts on it. */
export function TasksPage({ app, areas }: { app: TaskApp; areas: string[] }) {
  const navigate = useNavigate();
  const { id: idParam } = useParams();
  const selectedId = idParam ? Number(idParam) : null;
  const { data, isLoading, error } = useTaskList();
  const [tab, setTab] = useState<Tab>('active');
  const [type, setType] = useState<'all' | TaskType>('all');
  const [prios, setPrios] = useState<TaskPriority[]>([]);
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const [appFilter, setAppFilter] = useState<'all' | TaskApp>(app);
  const [newType, setNewType] = useState<TaskType | null>(null);

  const people = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data]);
  const me = data?.me;
  const inTab = (t: TaskSummaryDto, k: Tab) => (k === 'all' ? true : k === 'active' ? t.status !== 'done' : t.status === k);

  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.tasks ?? []).filter(
      (t) =>
        (appFilter === 'all' || t.app === appFilter) &&
        (type === 'all' || t.type === type) &&
        (!prios.length || prios.includes(t.priority)) &&
        (!mine || (!!me && t.assigneeIds.includes(me.id))) &&
        (!q || `${t.key} ${t.title} ${t.area}`.toLowerCase().includes(q)),
    );
  }, [data, appFilter, type, prios, mine, me, query]);
  const visible = useMemo(
    () =>
      base
        .filter((t) => inTab(t, tab))
        .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt)),
    [base, tab],
  );
  const stats = useMemo(() => {
    const all = (data?.tasks ?? []).filter((t) => (appFilter === 'all' || t.app === appFilter) && t.status !== 'done');
    return {
      active: all.length,
      bugs: all.filter((t) => t.type === 'bug').length,
      tasks: all.filter((t) => t.type === 'task').length,
      critical: all.filter((t) => t.priority === 'critical').length,
      review: all.filter((t) => t.status === 'in_review').length,
    };
  }, [data, appFilter]);

  // Desktop shows a task beside the list from the start; a phone shows the list.
  useEffect(() => {
    if (selectedId == null && visible[0] && window.innerWidth >= 1024) navigate(`/tasks/${visible[0].id}`, { replace: true });
  }, [selectedId, visible, navigate]);

  const showFrom = (s: 'bugs' | 'tasks' | 'critical' | 'review') => {
    setType(s === 'bugs' ? 'bug' : s === 'tasks' ? 'task' : 'all');
    setPrios(s === 'critical' ? ['critical'] : []);
    setTab(s === 'review' ? 'in_review' : 'active');
  };
  const reset = () => {
    setTab('all');
    setType('all');
    setPrios([]);
    setQuery('');
    setMine(false);
    setAppFilter('all');
  };

  if (isLoading) return <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm"><Loader2 className="size-4 animate-spin" /> Loading tasks…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{getApiErrorMessage(error, 'Could not load tasks.')}</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-muted-foreground mr-auto text-sm">
          <b className="text-foreground">{stats.active} active</b> · Report a problem or ask for something — it stays here until it is done.
        </p>
        <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300" onClick={() => setNewType('bug')}>
          <Bug /> Report bug
        </Button>
        <Button onClick={() => setNewType('task')}>
          <Plus /> New task
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { k: 'bugs' as const, label: 'Open bugs', v: stats.bugs, icon: Bug, tone: 'text-red-600 bg-red-50 dark:bg-red-500/10' },
          { k: 'tasks' as const, label: 'Open tasks', v: stats.tasks, icon: ListTodo, tone: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' },
          { k: 'critical' as const, label: 'Critical', v: stats.critical, icon: Flame, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
          { k: 'review' as const, label: 'In review', v: stats.review, icon: MessageSquare, tone: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10' },
        ].map((s) => (
          <button key={s.k} type="button" onClick={() => showFrom(s.k)} className="bg-card hover:border-primary/40 flex items-center gap-3 rounded-xl border p-3 text-left transition-colors">
            <span className={cn('inline-flex size-10 items-center justify-center rounded-lg', s.tone)}>
              <s.icon className="size-5" />
            </span>
            <span>
              <span className="text-muted-foreground block text-xs font-semibold">{s.label}</span>
              <span className="text-xl font-bold tabular-nums">{s.v}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className={cn('bg-card flex min-w-0 flex-col rounded-xl border', selectedId != null && 'max-lg:hidden')}>
          <nav className="flex flex-wrap gap-x-1 border-b px-2 pt-2" role="tablist">
            {TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn('-mb-px border-b-2 px-2.5 py-2 text-sm font-semibold whitespace-nowrap', tab === k ? 'border-primary text-foreground' : 'text-muted-foreground border-transparent')}
              >
                {TAB_LABEL[k]} <span className="text-muted-foreground ml-1 text-xs tabular-nums">{base.filter((t) => inTab(t, k)).length}</span>
              </button>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2 border-b p-2.5">
            <div className="relative min-w-40 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search id, title, area…" className="h-9 pl-8" />
            </div>
            <Seg value={type} onChange={setType} options={[['all', 'All'], ['bug', 'Bugs'], ['task', 'Tasks']]} />
            <Seg value={appFilter} onChange={setAppFilter} options={[['all', 'All apps'], ['OMS', 'OMS'], ['WMS', 'WMS']]} />
            <div className="flex gap-1">
              {TASK_PRIORITIES.map((p, i) => {
                const P = PRIO[p];
                const on = prios.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    title={P.label}
                    aria-pressed={on}
                    onClick={() => setPrios((ps) => (on ? ps.filter((x) => x !== p) : [...ps, p]))}
                    className={cn('inline-flex h-8 items-center gap-0.5 rounded-md border px-1.5 text-xs font-bold', on ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}
                  >
                    <P.icon className={cn('size-3.5', !on && P.tone)} />P{i + 1}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-pressed={mine}
              onClick={() => setMine((v) => !v)}
              className={cn('inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-bold', mine ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}
            >
              <UserRound className="size-3.5" /> Mine
            </button>
          </div>

          <div className="divide-y">
            {visible.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/tasks/${t.id}`)}
                className={cn('hover:bg-muted/50 flex w-full items-start gap-3 px-3 py-2.5 text-left', t.id === selectedId && 'bg-primary/5', t.status === 'done' && 'opacity-60')}
              >
                <TypeIcon type={t.type} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground font-mono text-xs font-bold">{t.key}</span>
                    <PrioTag p={t.priority} />
                    {t.app !== app && <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">{t.app}</span>}
                  </span>
                  <span className={cn('block truncate text-sm font-semibold', t.status === 'done' && 'line-through')}>{t.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {t.area} · by {people.get(t.reporterId)?.name ?? '?'} · {ago(t.createdAt)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <StatusChip status={t.status} />
                  <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" />{t.messageCount}</span>
                    <span className="inline-flex items-center gap-0.5"><Paperclip className="size-3" />{t.fileCount}</span>
                    <span className="flex -space-x-1.5">{t.assigneeIds.slice(0, 3).map((a) => <Avatar key={a} person={people.get(a)} className="ring-card size-5 text-[8px] ring-2" />)}</span>
                  </span>
                </span>
              </button>
            ))}
            {!visible.length && (
              <div className="text-muted-foreground flex flex-col items-center gap-2 p-8 text-center text-sm">
                <Inbox className="size-8 opacity-50" />
                Nothing here.
                <button type="button" onClick={reset} className="text-primary text-xs font-semibold hover:underline">Show everything</button>
              </div>
            )}
          </div>
          <footer className="text-muted-foreground border-t px-3 py-2 text-xs">{visible.length} shown of {data?.tasks.length ?? 0}</footer>
        </section>

        {selectedId != null ? (
          <TaskDetail key={selectedId} id={selectedId} people={people} me={me} areas={areas} onBack={() => navigate('/tasks')} />
        ) : (
          <section className="bg-card text-muted-foreground hidden flex-col items-center justify-center gap-2 rounded-xl border p-10 text-sm lg:flex">
            <Inbox className="size-8 opacity-50" /> Pick a task to see it here.
          </section>
        )}
      </div>

      {newType && (
        <NewTaskDialog
          app={app}
          initialType={newType}
          areas={areas}
          people={data?.people ?? []}
          onClose={() => setNewType(null)}
          onCreated={(t) => {
            reset();
            setTab('active');
            setAppFilter(app);
            navigate(`/tasks/${t.id}`);
          }}
        />
      )}
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <span className="bg-muted inline-flex rounded-md p-0.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cn('rounded px-2 py-1 text-xs font-semibold', value === v ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
          {label}
        </button>
      ))}
    </span>
  );
}

function PrioTag({ p }: { p: TaskPriority }) {
  const P = PRIO[p];
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-semibold', P.tone)}>
      <P.icon className="size-3.5" />
      {P.label}
    </span>
  );
}

/** Pick people, one at a time, from a plain select that resets after each pick. */
function PeoplePicker({ ids, people, onChange }: { ids: string[]; people: TaskPersonDto[]; onChange: (ids: string[]) => void }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const addable = people.filter((p) => !ids.includes(p.id)).sort((a, b) => Number(b.isDeveloper) - Number(a.isDeveloper) || a.name.localeCompare(b.name));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ids.map((id) => (
        <span key={id} className="bg-muted inline-flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-0.5 text-xs font-medium">
          <Avatar person={byId.get(id)} className="size-5 text-[8px]" />
          {byId.get(id)?.name ?? '?'}
          <button type="button" aria-label={`Remove ${byId.get(id)?.name ?? ''}`} onClick={() => onChange(ids.filter((x) => x !== id))} className="hover:bg-background rounded-full p-0.5">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {addable.length > 0 && (
        <select aria-label="Add a person" value="" onChange={(e) => e.target.value && onChange([...ids, e.target.value])} className={cn(SELECT, 'h-7 w-auto text-xs')}>
          <option value="">{ids.length ? '+ Add more' : '+ Add person'}</option>
          {addable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDeveloper ? ' · developer' : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">{label}</span>
      {children}
    </label>
  );
}

/** Pick files by click or drop. */
function DropZone({ onFiles, busy }: { onFiles: (files: File[]) => void; busy?: boolean }) {
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFiles(tooBig(Array.from(e.dataTransfer.files)));
      }}
      className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm"
    >
      <input
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          onFiles(tooBig(files));
        }}
      />
      {busy ? <Loader2 className="text-muted-foreground size-5 animate-spin" /> : <Upload className="text-muted-foreground size-5" />}
      <span>
        <b>{busy ? 'Uploading…' : 'Drop files or click to attach'}</b>
        <span className="text-muted-foreground block text-xs">Screenshots, videos, logs, PDFs — up to 25 MB each.</span>
      </span>
    </label>
  );
}

function FileChip({ file, thumb, onOpen, onRemove }: { file: { name: string; size: number }; thumb?: string; onOpen?: () => void; onRemove?: () => void }) {
  return (
    <span className="bg-background inline-flex max-w-64 items-center gap-2 rounded-lg border p-1.5 pr-2">
      <button type="button" onClick={onOpen} disabled={!onOpen} className="flex min-w-0 items-center gap-2 text-left">
        {thumb ? <img src={thumb} alt="" className="size-9 shrink-0 rounded object-cover" /> : <FileText className="text-muted-foreground size-9 shrink-0 p-1.5" />}
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold">{file.name}</span>
          <span className="text-muted-foreground text-[11px]">{size(file.size)}</span>
        </span>
      </button>
      {onRemove && (
        <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove} className="hover:bg-muted rounded p-0.5">
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
}

function eventText(e: TaskEventDto, people: Map<string, TaskPersonDto>): string {
  const d = e.data;
  const name = (id: unknown) => people.get(String(id))?.name ?? '?';
  switch (e.kind) {
    case 'created':
      return d.type === 'bug' ? 'reported this bug' : 'created this task';
    case 'status':
      return `moved it to ${STATUS_LABEL[d.to as TaskStatus] ?? d.to}`;
    case 'priority':
      return `set priority to ${PRIO[d.to as TaskPriority]?.label ?? d.to}`;
    case 'assigned':
      return `assigned ${name(d.to)}`;
    case 'unassigned':
      return `removed ${name(d.from)}`;
    case 'area':
      return `moved it to ${String(d.to)}`;
    case 'edited':
      return `edited the ${String(d.field ?? 'description')}`;
    case 'file_added':
      return `attached ${String(d.name ?? '')}`;
    case 'file_removed':
      return `removed ${String(d.name ?? '')}`;
    case 'completed':
      return 'marked it complete';
    case 'reopened':
      return 'reopened it';
    default:
      return e.kind;
  }
}

function TaskDetail({
  id, people, me, areas, onBack,
}: { id: number; people: Map<string, TaskPersonDto>; me?: { id: string; isDeveloper: boolean }; areas: string[]; onBack: () => void }) {
  const { data: d, isLoading } = useTask(id);
  const update = useUpdateTask();
  const reopen = useReopenTask();
  const addFiles = useAddTaskFiles();
  const removeFile = useRemoveTaskFile();
  const send = useSendComment();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  // Image attachments load through the signed-in download, so they need object URLs.
  const allFiles = useMemo(() => (d ? [...d.files, ...d.events.flatMap((e) => e.files)] : []), [d]);
  useEffect(() => {
    for (const f of allFiles) {
      if (!isImage(f) || thumbs[f.id]) continue;
      downloadTaskFile(f.id)
        .then((b) => setThumbs((t) => ({ ...t, [f.id]: URL.createObjectURL(b) })))
        .catch(() => {});
    }
  }, [allFiles, thumbs]);
  useEffect(() => () => Object.values(thumbs).forEach((u) => URL.revokeObjectURL(u)), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !d) {
    return (
      <section className="bg-card text-muted-foreground flex items-center gap-2 rounded-xl border p-6 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </section>
    );
  }

  const save = (input: Parameters<typeof update.mutate>[0]['input'], what: string) =>
    update.mutate({ id: d.id, input }, { onSuccess: (r) => toast.success(`${r.key} · ${what}`), onError: fail });

  /** Images open in place; everything else is saved — never opened as a page. */
  const openFile = async (f: TaskFileDto) => {
    if (isImage(f) && thumbs[f.id]) return setPreview({ url: thumbs[f.id], name: f.name });
    try {
      const url = URL.createObjectURL(await downloadTaskFile(f.id));
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      fail(e);
    }
  };
  const canRemove = (f: TaskFileDto) => !!me && (f.uploadedById === me.id || d.reporterId === me.id);
  const canSend = !send.isPending && (!!draft.trim() || draftFiles.length > 0);
  const doSend = () => {
    if (!canSend) return;
    send.mutate(
      { id: d.id, text: draft.trim(), files: draftFiles },
      {
        onSuccess: () => {
          setDraft('');
          setDraftFiles([]);
        },
        onError: fail,
      },
    );
  };
  const reporter = people.get(d.reporterId);
  const messages = d.events.filter((e) => e.kind === 'comment').length;

  return (
    <section className="bg-card flex min-w-0 flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label="Back to the list">
          <ArrowLeft />
        </Button>
        <button
          type="button"
          title="Copy link"
          onClick={() => {
            void navigator.clipboard?.writeText(`${d.key} ${location.origin}${import.meta.env.BASE_URL}tasks/${d.id}`);
            toast.success(`${d.key} link copied`);
          }}
          className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs font-bold"
        >
          {d.key}
        </button>
        <span className="inline-flex items-center gap-1 text-xs font-semibold">
          <TypeIcon type={d.type} className="size-3.5" />
          {d.type === 'bug' ? 'Bug' : 'Task'} · {d.app}
        </span>
        <StatusChip status={d.status} />
      </div>
      <div>
        <h3 className={cn('text-lg leading-snug font-bold', d.status === 'done' && 'line-through opacity-70')}>{d.title}</h3>
        <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
          <Avatar person={reporter} className="size-5 text-[8px]" />
          {reporter?.name ?? '?'} · {when(d.createdAt)} · updated {ago(d.updatedAt)}
        </p>
      </div>

      {d.status === 'done' ? (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <span className="flex-1">
            <b>Done by {people.get(d.doneById ?? '')?.name ?? '?'}</b> · {when(d.doneAt)}
            {d.resolution && <span className="mt-0.5 block whitespace-pre-wrap">{d.resolution}</span>}
          </span>
          <Button size="sm" variant="outline" onClick={() => reopen.mutate(d.id, { onSuccess: (r) => toast.success(`${r.key} reopened`), onError: fail })}>
            <RotateCcw /> Reopen
          </Button>
        </div>
      ) : me?.isDeveloper ? (
        <Button className="w-fit bg-emerald-600 hover:bg-emerald-700" onClick={() => setCompleteOpen(true)}>
          <CircleCheck /> Mark as complete
        </Button>
      ) : (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Lock className="size-3.5" /> Only a developer can mark this complete.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <select className={SELECT} value={d.status} onChange={(e) => (e.target.value === 'done' ? setCompleteOpen(true) : save({ status: e.target.value as Exclude<TaskStatus, 'done'> }, STATUS_LABEL[e.target.value as TaskStatus]))}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s} disabled={s === 'done' && (!me?.isDeveloper || d.status === 'done')}>
                {STATUS_LABEL[s]}
                {s === 'done' && !me?.isDeveloper ? ' · developers only' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select className={SELECT} value={d.priority} onChange={(e) => save({ priority: e.target.value as TaskPriority }, PRIO[e.target.value as TaskPriority].label)}>
            {TASK_PRIORITIES.map((p, i) => (
              <option key={p} value={p}>
                {PRIO[p].label} · P{i + 1}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Area">
          <select className={SELECT} value={d.area} onChange={(e) => save({ area: e.target.value }, e.target.value)}>
            {[...new Set([...areas, d.area])].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Assigned to</span>
          <PeoplePicker ids={d.assigneeIds} people={[...people.values()]} onChange={(ids) => save({ assigneeIds: ids }, 'people updated')} />
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-bold">Description</h4>
        <p className={cn('text-sm whitespace-pre-wrap', !d.description && 'text-muted-foreground italic')}>{d.description || 'No description.'}</p>
        {d.steps.length > 0 && (
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
            {d.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-bold">Attachments <span className="text-muted-foreground font-normal">{d.files.length}</span></h4>
        {d.files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {d.files.map((f) => (
              <FileChip key={f.id} file={f} thumb={thumbs[f.id]} onOpen={() => void openFile(f)} onRemove={canRemove(f) ? () => removeFile.mutate(f.id, { onError: fail }) : undefined} />
            ))}
          </div>
        )}
        <DropZone busy={addFiles.isPending} onFiles={(files) => files.length && addFiles.mutate({ id: d.id, files }, { onSuccess: (r) => toast.success(`${files.length} file(s) added to ${r.key}`), onError: fail })} />
      </div>

      <div>
        <h4 className="mb-2 text-sm font-bold">
          Discussion <span className="text-muted-foreground font-normal">{messages} {messages === 1 ? 'message' : 'messages'}</span>
        </h4>
        <ol className="space-y-2.5">
          {d.events.map((e) =>
            e.kind === 'comment' ? (
              <li key={e.id} className="flex gap-2">
                <Avatar person={people.get(e.userId ?? '')} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-xs">
                    <b>{people.get(e.userId ?? '')?.name ?? '?'}</b>
                    {people.get(e.userId ?? '')?.isDeveloper && <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">developer</span>}
                    <span className="text-muted-foreground" title={when(e.createdAt)}>{ago(e.createdAt)}</span>
                  </div>
                  {e.text && <p className={cn('mt-1 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap', e.userId === me?.id ? 'bg-primary/10' : 'bg-muted')}>{e.text}</p>}
                  {e.files.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {e.files.map((f) => (
                        <FileChip key={f.id} file={f} thumb={thumbs[f.id]} onOpen={() => void openFile(f)} />
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ) : (
              <li key={e.id} className="text-muted-foreground flex items-center gap-2 pl-1 text-xs">
                <span className="bg-muted-foreground/40 size-1.5 shrink-0 rounded-full" />
                <span className="flex-1">
                  <b className="text-foreground">{people.get(e.userId ?? '')?.name ?? 'System'}</b> {eventText(e, people)}
                  {e.kind === 'completed' && e.text && <span className="italic"> — “{e.text}”</span>}
                </span>
                <span title={when(e.createdAt)}>{ago(e.createdAt)}</span>
              </li>
            ),
          )}
        </ol>

        <div
          className="mt-3 rounded-lg border p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setDraftFiles((f) => [...f, ...tooBig(Array.from(e.dataTransfer.files))]);
          }}
        >
          <textarea
            rows={2}
            value={draft}
            disabled={send.isPending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                doSend();
              }
            }}
            placeholder="Write a reply…"
            className="w-full resize-y bg-transparent p-1 text-sm outline-none"
          />
          {draftFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {draftFiles.map((f, i) => (
                <FileChip key={i} file={f} onRemove={() => setDraftFiles((fs) => fs.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="hover:bg-muted inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold">
              <input
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  setDraftFiles((f) => [...f, ...tooBig(files)]);
                }}
              />
              <Paperclip className="size-3.5" /> Attach
            </label>
            <span className="text-muted-foreground mr-auto text-[11px] max-sm:hidden">Ctrl + Enter to send</span>
            <Button size="sm" disabled={!canSend} onClick={doSend}>
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send
            </Button>
          </div>
        </div>
      </div>

      {completeOpen && <CompleteDialog task={d} reporter={reporter} isReporter={d.reporterId === me?.id} onClose={() => setCompleteOpen(false)} />}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl p-2">
          <DialogTitle className="truncate px-2 text-sm">{preview?.name}</DialogTitle>
          {preview && <img src={preview.url} alt={preview.name} className="max-h-[80vh] w-full object-contain" />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CompleteDialog({ task, reporter, isReporter, onClose }: { task: TaskDetailDto; reporter?: TaskPersonDto; isReporter: boolean; onClose: () => void }) {
  const complete = useCompleteTask();
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  return (
    <Dialog open onOpenChange={(o) => !o && !complete.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as complete</DialogTitle>
          <DialogDescription>
            <span className="font-mono font-bold">{task.key}</span> {task.title}
          </DialogDescription>
        </DialogHeader>
        <Field label="What was done (optional)">
          <textarea autoFocus rows={3} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fixed the rounding in the challan total." className="border-input bg-background rounded-md border p-2 text-sm" />
        </Field>
        {!isReporter && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4" />
            Tell {reporter?.name ?? 'the reporter'} it is done
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={complete.isPending}>Cancel</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={complete.isPending}
            onClick={() =>
              complete.mutate(
                { id: task.id, resolution: note.trim(), notify },
                {
                  onSuccess: (r) => {
                    toast.success(`${r.key} completed`);
                    onClose();
                  },
                  onError: fail,
                },
              )
            }
          >
            {complete.isPending ? <Loader2 className="animate-spin" /> : <CircleCheck />} Mark as complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewTaskDialog({
  app, initialType, areas, people, onClose, onCreated,
}: { app: TaskApp; initialType: TaskType; areas: string[]; people: TaskPersonDto[]; onClose: () => void; onCreated: (t: TaskDetailDto) => void }) {
  const create = useCreateTask();
  const [type, setType] = useState<TaskType>(initialType);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [priority, setPriority] = useState<TaskPriority>(initialType === 'bug' ? 'high' : 'medium');
  const [area, setArea] = useState(areas[0] ?? 'Other');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const titleOk = title.trim().length >= 4;

  const submit = () => {
    if (!titleOk || create.isPending) return;
    create.mutate(
      {
        input: {
          app,
          type,
          title: title.trim(),
          description: description.trim(),
          steps: type === 'bug' ? steps.split('\n').map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean) : [],
          area,
          priority,
          assigneeIds,
        },
        files,
      },
      {
        onSuccess: (t) => {
          toast.success(`${t.key} created`);
          onClose();
          onCreated(t);
        },
        onError: fail,
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{type === 'bug' ? 'Report a bug' : 'New task'}</DialogTitle>
          <DialogDescription>{type === 'bug' ? 'Something is broken or wrong — say what, and how to see it.' : 'Something to build, change or check.'}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(['bug', 'task'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => setType(t)}
              className={cn('flex items-center gap-2 rounded-lg border p-3 text-left text-sm', type === t ? 'border-primary bg-primary/5 ring-primary/30 ring-1' : 'hover:bg-muted/50')}
            >
              <TypeIcon type={t} className="size-5" />
              <span>
                <b>{t === 'bug' ? 'Bug' : 'Task'}</b>
                <span className="text-muted-foreground block text-xs">{t === 'bug' ? 'Broken or wrong' : 'New work or a change'}</span>
              </span>
            </button>
          ))}
        </div>
        <Field label="Title *">
          <Input autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'bug' ? 'e.g. Challan total is off by ₹1' : 'e.g. Add a transporter filter to Dispatch'} aria-invalid={!!title && !titleOk} />
        </Field>
        <Field label="Description">
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="border-input bg-background rounded-md border p-2 text-sm" placeholder={type === 'bug' ? 'What happened, and what should have happened?' : 'What is needed, and why?'} />
        </Field>
        {type === 'bug' && (
          <Field label="Steps to reproduce · one per line">
            <textarea rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} className="border-input bg-background rounded-md border p-2 text-sm" placeholder={'Open Dispatch\nPick a party\nPress Save'} />
          </Field>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Priority</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TASK_PRIORITIES.map((p, i) => {
              const P = PRIO[p];
              return (
                <button key={p} type="button" aria-pressed={priority === p} onClick={() => setPriority(p)} className={cn('rounded-lg border p-2 text-left', priority === p ? 'border-primary bg-primary/5 ring-primary/30 ring-1' : 'hover:bg-muted/50')}>
                  <span className={cn('flex items-center gap-1 text-sm font-bold', P.tone)}>
                    <P.icon className="size-4" />
                    {P.label} <small className="text-muted-foreground font-medium">P{i + 1}</small>
                  </span>
                  <span className="text-muted-foreground text-[11px]">{P.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Area">
            <select className={SELECT} value={area} onChange={(e) => setArea(e.target.value)}>
              {areas.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Assign to</span>
            <PeoplePicker ids={assigneeIds} people={people} onChange={setAssigneeIds} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Attachments</span>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <FileChip key={i} file={f} onRemove={() => setFiles((fs) => fs.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
          <DropZone onFiles={(f) => setFiles((fs) => [...fs, ...f])} />
        </div>
        {!assigneeIds.length && <p className="text-muted-foreground text-xs">Nobody assigned — the developers will be told there is something to pick up.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!titleOk || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : type === 'bug' ? <Bug /> : <Plus />}
            {type === 'bug' ? 'Report bug' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
