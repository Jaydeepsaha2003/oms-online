import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Download, Flame, Loader2, Pencil, RotateCcw, Search, Sparkles, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { DesignTrackRow } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, shortOrderCode } from '@/lib/utils';
import { useDateFormat } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { usePageSize } from '@/hooks/use-page-size';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LiveLinePhotos, PhotoLightbox, type LinePhoto } from '@/features/orders/line-photos';
import { exportDesignTrack, useDesignTrack, useDesignTrackFilterOptions, useDesignTrackTypes, useSetKalwat } from './use-design-track';

const qty = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/**
 * How far along the line is. Kept to four states so the list is scannable:
 * untouched needs picking up, partial is in progress, done is clear, and
 * over-entered is almost always a typo worth spotting.
 *
 * Named states rather than a bare colour, because the two views need the same
 * judgement expressed differently — the desktop grid tints the whole row, while
 * a phone card says it in words. A colour alone cannot be read on a phone with
 * no legend and no neighbouring rows to compare against, which is also why the
 * card has no coloured rail: on a list where most lines are "not started" it
 * painted the whole screen red while adding nothing the chip did not say.
 */
type TrackState = 'OVER' | 'NEW' | 'DONE' | 'PART';

function rowState(r: DesignTrackRow): TrackState {
  if (r.remaining < 0) return 'OVER'; // more entered than ordered
  // Checked BEFORE "nothing typed yet": a line dispatched in full has nothing
  // left to do, and calling it "Not started" beside a Remaining of 0 would
  // contradict itself on the same card.
  if (r.remaining === 0) return 'DONE';
  if (r.kalwat == null) return 'NEW'; // nothing entered, and work still to do
  return 'PART'; // part-way
}

const STATE_META: Record<
  TrackState,
  {
    label: string;
    /** Row wash on the desktop grid. */
    tint: string;
    /** Worded chip on the desktop grid (ringed, to sit on a tinted row). */
    chip: string;
    /** Filled chip for the phone card, where there is no row tint under it and
     *  a ring would only add a third border to a card that already has two. */
    chipSolid: string;
  }
> = {
  OVER: {
    label: 'Over-entered',
    tint: 'bg-rose-100 dark:bg-rose-500/15',
    chip: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/25',
    chipSolid: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  },
  NEW: {
    label: 'Not started',
    tint: 'bg-red-50 dark:bg-red-500/10',
    chip: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/25',
    chipSolid: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
  },
  DONE: {
    label: 'Done',
    tint: 'bg-emerald-50 dark:bg-emerald-500/10',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25',
    chipSolid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  },
  PART: {
    label: 'In progress',
    tint: 'bg-amber-50 dark:bg-amber-500/10',
    chip: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25',
    chipSolid: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  },
};

const rowTone = (r: DesignTrackRow): string => STATE_META[rowState(r)].tint;

/** Same staggered entry the Dispatch Orders cards use — the list settles in
 *  order instead of appearing all at once. */
const TRACK_CARD_CSS = `
.track-card-in { animation: trackCardIn .34s cubic-bezier(.22,1,.36,1) both; }
@keyframes trackCardIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .track-card-in { animation: none; } }
`;

/**
 * A tracked line as a phone card, in the Dispatch Orders card language.
 *
 * Not a `role="button"` like a dispatch card is: there is no sheet to open here,
 * and the two things you CAN do — type a Kalwat, look at the photos — are real
 * buttons inside it. Making the whole card tappable would only add a target that
 * does nothing, and nesting those buttons inside it makes the inner taps
 * unreliable on a phone.
 */
function TrackCard({
  row: r,
  index,
  canEdit,
  formatDate,
  onPhotos,
}: {
  row: DesignTrackRow;
  index: number;
  canEdit: boolean;
  formatDate: (v: string) => string;
  onPhotos: () => void;
}) {
  const state = rowState(r);
  const st = STATE_META[state];
  const urgent = r.priority === 'URGENT';
  const photoCount = r.photoCount ?? 0;
  /*
   * All three pills, always — including at zero.
   *
   * These were filtered on `v !== 0`, which is right for a card that lists
   * whichever units a line happens to carry, and wrong here: Design Track shows
   * PENDING lines, so "dispatched" is legitimately 0 on most of them, and hiding
   * the pill made the figure look missing rather than nil. A zero is the answer
   * to "how much has shipped?", not the absence of one.
   */
  const qtys = [
    ['Bags', r.bags],
    ['Disp', r.dispatchedBags ?? 0],
    ['Rem', r.remaining],
  ] as const;

  return (
    <div
      className={cn(
        'bg-card relative overflow-hidden rounded-2xl border shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.04]',
        // URGENT still tints the whole card — that one IS worth shouting about,
        // and unlike the progress state it is rare enough to stay quiet.
        urgent && 'border-rose-300 bg-rose-50/60 ring-rose-200 dark:border-rose-400/30 dark:bg-rose-500/[0.06] dark:ring-rose-400/20',
      )}
    >
      <div className="track-card-in space-y-2.5 p-3.5 text-[13px]" style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}>
        {/* Order code + priority left, state right — the dispatch card's top row. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="bg-primary/10 text-primary rounded-lg px-2 py-0.5 font-mono text-[12.5px] font-bold">
              {shortOrderCode(r.orderCode, r.orderId)}
            </span>
            {/* URGENT only. Every card here also carries a state chip on the
                right, so a "NORMAL" chip on the left was a third badge that
                never varied — and the absence of an urgent flag IS normal. */}
            {urgent && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                <Flame className="size-2.5" /> URGENT
              </span>
            )}
          </div>
          <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold', st.chipSolid)}>{st.label}</span>
        </div>

        <div>
          <p className="text-[16.5px] leading-tight font-bold break-words text-slate-900 dark:text-slate-50">{r.customerName}</p>
          <p className="text-muted-foreground mt-0.5 text-[11.5px] font-medium">Ordered {formatDate(r.orderDate)}</p>
        </div>

        <div className="bg-muted/60 rounded-xl px-3 py-2">
          <p className="text-[14.5px] leading-snug font-semibold break-words">{r.productName || '—'}</p>
          {r.designName && (
            <p className="text-muted-foreground mt-0.5 text-[11.5px] font-medium tracking-wide break-words">{r.designName}</p>
          )}
        </div>

        {/* Quantity pills + the round photo target, as on a dispatch card. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {qtys.map(([label, v]) => (
                <span
                  key={label}
                  className={cn(
                    'inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1',
                    label === 'Rem' && r.remaining < 0
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                      : label === 'Rem' && r.remaining === 0
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                        : 'bg-primary/8 text-primary',
                  )}
                >
                  <span className="text-[10px] font-bold tracking-wider uppercase opacity-65">{label}</span>
                  <span className="text-[14px] leading-none font-extrabold tabular-nums">{qty(v)}</span>
                </span>
            ))}
          </div>
          <button
            type="button"
            onClick={onPhotos}
            className={cn(
              'relative flex size-9 shrink-0 items-center justify-center rounded-full ring-1 active:scale-95',
              photoCount
                ? 'bg-indigo-50 text-indigo-600 ring-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/25'
                : 'text-muted-foreground bg-slate-50 ring-slate-200 dark:bg-white/5 dark:ring-white/10',
            )}
            aria-label={photoCount ? `View ${photoCount} photo${photoCount === 1 ? '' : 's'}` : 'Add a reference photo'}
          >
            <Camera className="size-4.5" />
            {photoCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold tabular-nums text-white">
                {photoCount > 9 ? '9+' : photoCount}
              </span>
            )}
          </button>
        </div>

        {/* Kalwat is the one thing typed on this screen, so it sits apart from
            the read-only pills, above the fold of the comment, at full width. */}
        <div className="border-t pt-2">
          <KalwatCell row={r} canEdit={canEdit} variant="card" />
        </div>

        {r.comment && (
          <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:ring-rose-400/20">
            <TriangleAlert className="mt-[1px] size-3.5 shrink-0 text-rose-600" />
            <p className="text-[13.5px] leading-snug font-bold break-words text-rose-600 dark:text-rose-300">{r.comment}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Click-to-edit Kalwat cell: shows the number, becomes an input on click, saves
 * on blur (and on Enter). Escape abandons the edit.
 *
 * Only commits when the value actually changed, so tabbing through the grid
 * doesn't fire a write per cell.
 */
function KalwatCell({
  row,
  canEdit,
  variant = 'grid',
}: {
  row: DesignTrackRow;
  canEdit: boolean;
  /**
   * 'grid' is the desktop table cell. 'card' is the phone control: a finger is
   * not a mouse pointer, and a 20-unit-wide cell 5px tall is not something you
   * can reliably hit or read at arm's length — the card version is a full-width
   * 40px target that says what it is, since on a phone there is no column
   * header above it to name the number.
   */
  variant?: 'grid' | 'card';
}) {
  const save = useSetKalwat();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const begin = () => {
    if (!canEdit) return;
    setText(row.kalwat == null ? '' : String(row.kalwat));
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = text.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next != null && (!Number.isFinite(next) || next < 0)) {
      toast.error('Kalwat must be a positive number (or blank to clear)');
      return;
    }
    if (next === row.kalwat) return; // untouched — nothing to write
    save.mutate(
      { orderItemId: row.orderItemId, kalwat: next },
      { onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save Kalwat')) },
    );
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        step="any"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className={cn(
          'border-primary bg-background text-right font-bold tabular-nums outline-none',
          variant === 'card'
            ? 'h-11 w-full rounded-xl border-2 px-3 text-[17px]'
            : 'w-20 rounded-[3px] border-2 px-1.5 py-0.5 text-[13px]',
        )}
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      onClick={begin}
      disabled={!canEdit}
      title={canEdit ? 'Click to type the processed quantity' : 'You do not have permission to edit this'}
      className={cn(
        'font-semibold tabular-nums transition-colors',
        variant === 'card'
          ? // A field, not a chip: label on the left, the figure on the right at
            // the size a figure deserves, and a pencil saying it can be typed.
            // The old version put a lone "—" in the middle of a yellow box,
            // which read as broken rather than empty.
            cn(
              'flex h-11 w-full items-center gap-2 rounded-xl border px-3 text-left',
              canEdit
                ? 'cursor-pointer border-amber-300 bg-amber-50/60 active:bg-amber-100/70 dark:border-amber-400/35 dark:bg-amber-500/10'
                : 'border-border bg-muted/40',
            )
          : cn(
              'w-20 rounded-[3px] border px-1.5 py-0.5 text-right text-[13px]',
              canEdit ? 'cursor-pointer border-amber-300 bg-amber-50/70 hover:border-amber-500 dark:border-amber-400/40 dark:bg-amber-500/10' : 'border-transparent',
              row.kalwat == null && 'text-muted-foreground font-normal',
            ),
      )}
    >
      {variant === 'card' ? (
        <>
          <span className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">Kalwat</span>
          <span className="ml-auto flex items-center gap-2">
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : row.kalwat == null ? (
              <span className="text-placeholder text-[13px] font-medium">{canEdit ? 'Tap to enter' : 'Not entered'}</span>
            ) : (
              <span className="text-[18px] leading-none font-extrabold">{row.kalwat}</span>
            )}
            {canEdit && <Pencil className="text-muted-foreground/60 size-3.5 shrink-0" />}
          </span>
        </>
      ) : save.isPending ? (
        <Loader2 className="mx-auto size-3.5 animate-spin" />
      ) : (
        <span>{row.kalwat ?? '—'}</span>
      )}
    </button>
  );
}

export function DesignTrackPage() {
  const { can } = usePermissions();
  const canEdit = can('designtrack:update');
  const { formatDate } = useDateFormat();
  const { page, setPage, pageSize, setPageSize } = usePageSize('design-track');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [product, setProduct] = useState('');
  const [design, setDesign] = useState('');
  const [activePhotoLine, setActivePhotoLine] = useState<DesignTrackRow | null>(null);
  const [viewingHistoryPhoto, setViewingHistoryPhoto] = useState<{ photos: LinePhoto[]; index: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = {
    search: search || undefined,
    customer: customer || undefined,
    product: product || undefined,
    design: design || undefined,
  };
  const { data, isLoading, refetch, isFetching } = useDesignTrack({ page, pageSize, ...filters });
  const { data: options } = useDesignTrackFilterOptions(filters);
  const { data: tracked } = useDesignTrackTypes();

  const rows = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const hasFilters = !!(search || customer || product || design);
  const reset = () => {
    setSearchInput('');
    setCustomer('');
    setProduct('');
    setDesign('');
    setPage(1);
  };

  // Totals for the page in view, so the numbers can be sanity-checked at a glance.
  const totals = useMemo(
    () => ({
      bags: rows.reduce((a, r) => a + r.bags, 0),
      kalwat: rows.reduce((a, r) => a + (r.kalwat ?? 0), 0),
      dispatched: rows.reduce((a, r) => a + (r.dispatchedBags ?? 0), 0),
      remaining: rows.reduce((a, r) => a + r.remaining, 0),
    }),
    [rows],
  );

  const nothingTracked = (tracked?.selected.length ?? 0) === 0;

  return (
    <div className="space-y-3 font-sans">
      {/* Header. The title block is desktop-only: the app bar already shows
          "Design Track" on a phone, and printing it twice cost a whole row of
          vertical space above the search box — on a 375px screen that is the
          difference between seeing the first card and not. The action buttons
          stay, so the row is not empty. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="bg-gradient-brand hidden size-9 items-center justify-center rounded-[4px] text-white shadow-md shadow-blue-600/20 ring-1 ring-white/20 sm:flex">
          <Sparkles className="size-4" />
        </div>
        <div className="hidden min-w-0 sm:block">
          <h2 className="truncate text-[17px] leading-tight font-bold tracking-tight">Design Track</h2>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            Pending orders filtered by tracked designs
          </p>
        </div>
        {/* Count as a chip beside the title, and icon-only buttons below sm, so
            the whole header stays on ONE line on a phone. It used to wrap onto a
            second row of full-width buttons, which pushed the list itself below
            the fold before a single item could be seen. */}
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums dark:bg-white/10">
            {data?.total ?? 0}
            <span className="hidden sm:inline"> items</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            className="size-9 p-0 sm:size-auto sm:px-3"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh"
          >
            {isFetching ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          {can('designtrack:export') && (
            <Button
              size="sm"
              className="size-9 p-0 sm:size-auto sm:px-3"
              onClick={() =>
                void exportDesignTrack(filters).catch((e) => toast.error(getApiErrorMessage(e, 'Excel export failed')))
              }
              aria-label="Export Excel"
            >
              <Download />
              <span className="hidden sm:inline">Export Excel</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filters. On phones the three dropdowns sit in an even 2-up grid — with
          fixed widths they filled neither the row nor each other, leaving the
          ragged half-empty gaps the screenshot shows. */}
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        <div className="relative col-span-2 w-full sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search customer, product, comment…"
            className="h-9 pl-8"
          />
        </div>
        <div className="w-full min-w-0 sm:w-52">
          <NativeSelect
            value={customer}
            onChange={(v) => {
              setCustomer(v);
              setPage(1);
            }}
            options={['', ...(options?.customers ?? [])]}
            placeholder="All customers"
          />
        </div>
        <div className="w-full min-w-0 sm:w-52">
          <NativeSelect
            value={product}
            onChange={(v) => {
              setProduct(v);
              setPage(1);
            }}
            options={['', ...(options?.products ?? [])]}
            placeholder="All products"
          />
        </div>
        <div className="w-full min-w-0 sm:w-48">
          <NativeSelect
            value={design}
            onChange={(v) => {
              setDesign(v);
              setPage(1);
            }}
            options={['', ...(options?.designs ?? [])]}
            placeholder="All designs"
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 w-full sm:w-auto" onClick={reset}>
            <RotateCcw /> Reset
          </Button>
        )}
      </div>

      {nothingTracked && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-300">
          No design types are being tracked yet, so this list is empty. Pick the designs to watch in{' '}
          <span className="font-semibold">Settings → Dispatch → Design Track</span>.
        </p>
      )}

      {/* Grid. Header stays put while scrolling the rows. Nine columns need
          68rem to lay out, so on a phone it is replaced by the card list below
          rather than left to scroll sideways — the screenshot's cut-off Order
          Date column was the first casualty of that. */}
      <div className="hidden max-h-[min(70vh,44rem)] overflow-auto rounded-lg border sm:block">
        <table className="w-full min-w-[68rem] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:bg-gradient-to-b [&_th]:from-blue-800 [&_th]:to-indigo-800 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-extrabold [&_th]:tracking-wide [&_th]:text-white [&_th]:uppercase">
              <th className="w-24">Order Date</th>
              <th>Customer Name</th>
              <th>Product Name</th>
              <th className="min-w-[7rem] max-w-[14rem]">Design Name</th>
              <th className="w-20 text-right">Bags</th>
              <th>Comment</th>
              <th className="w-24 text-right">Kalwat</th>
              <th className="w-24 text-right">Dispatched</th>
              <th className="w-24 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody className="[&_td]:border-b [&_td]:px-3 [&_td]:py-1">
            {isLoading ? (
              <tr>
                <td colSpan={9} className="text-muted-foreground py-10 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-muted-foreground py-10 text-center text-sm">
                  {nothingTracked ? 'Nothing tracked yet.' : 'No pending lines for the tracked designs.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.orderItemId} className={rowTone(r)}>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(r.orderDate)}</td>
                  <td className="font-semibold">{r.customerName}</td>
                  <td className="font-semibold">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{r.productName || '—'}</span>
                      {r.priority === 'URGENT' ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-[1px] text-[10px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                          <Flame className="size-2.5" /> URGENT
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-[1px] text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {r.priority || 'NORMAL'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setActivePhotoLine(r)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[10px] font-semibold transition-all border shadow-2xs cursor-pointer',
                          r.photoCount
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-400 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300'
                            : 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:border-slate-800 dark:bg-slate-900',
                        )}
                        title={r.photoCount ? `${r.photoCount} reference photo(s) available` : 'Add or view reference photo'}
                      >
                        <Camera className="size-3" />
                        {r.photoCount ? <span className="tabular-nums">{r.photoCount}</span> : null}
                      </button>
                    </div>
                  </td>
                  <td className="whitespace-normal break-words max-w-[14rem]">{r.designName || '—'}</td>
                  <td className="text-right font-medium tabular-nums">{r.bags.toFixed(2)}</td>
                  <td className="text-muted-foreground max-w-[16rem] truncate" title={r.comment ?? undefined}>
                    {r.comment || ''}
                  </td>
                  <td className="text-right">
                    <KalwatCell row={r} canEdit={canEdit} />
                  </td>
                  <td className="text-right font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    {r.dispatchedBags ? r.dispatchedBags.toFixed(2) : '—'}
                  </td>
                  <td
                    className={cn(
                      'text-right font-bold tabular-nums',
                      r.remaining < 0 ? 'text-rose-700 dark:text-rose-300' : r.remaining === 0 ? 'text-emerald-700 dark:text-emerald-400' : '',
                    )}
                    title="Bags ordered − whichever is further along: Kalwat entered, or already dispatched"
                  >
                    {qty(r.remaining)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="[&_td]:sticky [&_td]:bottom-0 [&_td]:border-t-2 [&_td]:border-slate-300 [&_td]:bg-slate-100 [&_td]:px-3 [&_td]:py-1.5 [&_td]:font-bold dark:[&_td]:border-white/20 dark:[&_td]:bg-slate-800">
                {/* Spans Order Date → Design Name, so Bags still lines up. */}
                <td colSpan={4} className="text-[11.5px] tracking-wide uppercase">
                  Page total
                </td>
                <td className="text-right tabular-nums">{totals.bags.toFixed(2)}</td>
                <td />
                <td className="text-right tabular-nums">{qty(totals.kalwat)}</td>
                <td className="text-right tabular-nums">{totals.dispatched ? totals.dispatched.toFixed(2) : '0.00'}</td>
                <td className="text-right tabular-nums">{qty(totals.remaining)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Phones: one card per line ─────────────────────────────────────────
          Built in the same idiom as the Dispatch Orders cards — the same left
          rail, order-code chip, muted product block, primary quantity pills,
          round tap targets and staggered entry — because these two screens are
          worked one after the other on the same phone, and two different card
          languages for the same kind of row is just friction.

          Nothing truncates: a card is the ONLY view of this line on a phone, so
          a clipped product name, design or comment is information the user
          cannot reach. Long values wrap. */}
      <div className="space-y-3 px-0.5 sm:hidden">
        <style>{TRACK_CARD_CSS}</style>
        {isLoading ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="bg-muted/40 h-44 animate-pulse rounded-2xl border" />)
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground bg-card flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-12 text-center text-sm">
            <Sparkles className="size-9 text-blue-500" />
            {nothingTracked ? 'Nothing tracked yet.' : 'No pending lines for the tracked designs.'}
          </div>
        ) : (
          rows.map((r, i) => <TrackCard key={r.orderItemId} row={r} index={i} canEdit={canEdit} formatDate={formatDate} onPhotos={() => setActivePhotoLine(r)} />)
        )}
        {/* Totals and paging in one bar, after the last card — the same four
            figures as the desktop footer row, which cannot exist here because
            there is no table for it to align to. Inside the list rather than
            pinned above it, so it reads as the end of the list. */}
        {rows.length > 0 && (
          <div className="bg-card mt-2.5 space-y-1 rounded-xl border px-2.5 py-1.5 shadow-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              {(
                [
                  ['Bags', totals.bags.toFixed(2)],
                  ['Kalwat', qty(totals.kalwat)],
                  ['Disp', totals.dispatched ? totals.dispatched.toFixed(2) : '0.00'],
                  ['Rem', qty(totals.remaining)],
                ] as const
              ).map(([label, value]) => (
                <span key={label} className="flex items-baseline gap-1">
                  <span className="text-muted-foreground text-[9px] font-bold tracking-widest uppercase">{label}</span>
                  <span className="text-[12px] font-bold tabular-nums text-slate-800 dark:text-slate-100">{value}</span>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-[11px] font-medium">
                <span className="text-foreground font-bold tabular-nums">{rows.length}</span> of{' '}
                <span className="text-foreground font-bold tabular-nums">{data?.total ?? 0}</span>
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <PageSizeSelect value={pageSize} onChange={setPageSize} hideLabel />
                <span className="text-[11px] font-bold tabular-nums whitespace-nowrap">
                  {data?.page ?? page}/{totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 rounded-[4px]"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 rounded-[4px]"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Paging (desktop — phones use the compact bar inside the card list) */}
      <div className="hidden items-center justify-between gap-3 sm:flex">
        <p className="text-muted-foreground text-sm">
          Page {data?.page ?? page} of {totalPages}
        </p>
        <div className="flex items-center gap-3">
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop only: on a phone the Kalwat control is labelled and visibly
          tappable, so these two lines would only sit between the user and the
          list they came for. */}
      <p className="text-muted-foreground hidden text-[11px] sm:block">
        Kalwat is typed by hand — click the cell, enter the processed quantity, and it saves when you click away.
        Remaining is <span className="font-semibold">Bags ordered − whichever is further along, the Kalwat or the Dispatched</span>
        , so it moves the moment you save and reads 0 once a line has shipped in full. Goods cannot ship before they are
        processed, so Dispatched acts as a floor on progress. A negative Remaining means more was entered than was ordered.
      </p>

      {/* Reference Photo Dialog */}
      {activePhotoLine && (
        <Dialog open onOpenChange={() => setActivePhotoLine(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-bold">
                <Camera className="size-4 text-indigo-600" />
                <span>Reference Photos</span>
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {activePhotoLine.customerName} · <span className="font-semibold">{activePhotoLine.productName || 'Item'}</span>
              </p>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <LiveLinePhotos orderItemId={activePhotoLine.orderItemId} canEdit={canEdit} />

              {activePhotoLine.photos && activePhotoLine.photos.some((p) => p.fromHistory) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
                  <p className="font-bold mb-1.5 flex items-center gap-1">
                    <Sparkles className="size-3.5 text-amber-600" /> Historical Party Reference Photo:
                  </p>
                  <div className="flex gap-2 overflow-x-auto pt-1">
                    {activePhotoLine.photos
                      .filter((p) => p.fromHistory)
                      .map((p, i, arr) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setViewingHistoryPhoto({ photos: arr.map((item) => ({ url: item.url, filename: item.filename, title: item.title })), index: i })}
                          className="group relative size-16 shrink-0 overflow-hidden rounded-md border border-amber-300 bg-white shadow-xs hover:ring-2 hover:ring-indigo-500 cursor-pointer"
                          title={p.title || p.filename || 'View historical photo'}
                        >
                          <img src={p.url} alt={p.filename || 'Reference photo'} className="size-full object-cover" />
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {viewingHistoryPhoto && (
        <PhotoLightbox
          photos={viewingHistoryPhoto.photos}
          index={viewingHistoryPhoto.index}
          onIndex={(index) => setViewingHistoryPhoto((prev) => (prev ? { ...prev, index } : null))}
          onClose={() => setViewingHistoryPhoto(null)}
        />
      )}
    </div>
  );
}

/** One labelled figure inside a phone card's number strip. */
function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-[9px] font-bold tracking-widest uppercase">{label}</p>
      <p className={cn('text-[13.5px] font-bold tabular-nums text-slate-800 dark:text-slate-100', className)}>{value}</p>
    </div>
  );
}

export default DesignTrackPage;
