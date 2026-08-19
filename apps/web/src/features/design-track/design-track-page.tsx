import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Download, Flame, Loader2, RotateCcw, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { DesignTrackRow } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
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
 * Row tint by how far along the line is. Kept to four states so the grid is
 * scannable: untouched needs picking up, partial is in progress, done is clear,
 * and over-entered is almost always a typo worth spotting.
 */
function rowTone(r: DesignTrackRow): string {
  if (r.remaining < 0) return 'bg-rose-100 dark:bg-rose-500/15'; // more processed than ordered
  if (r.kalwat == null) return 'bg-red-50 dark:bg-red-500/10'; // nothing entered yet
  if (r.remaining === 0) return 'bg-emerald-50 dark:bg-emerald-500/10'; // complete
  return 'bg-amber-50 dark:bg-amber-500/10'; // part-way
}

/**
 * Click-to-edit Kalwat cell: shows the number, becomes an input on click, saves
 * on blur (and on Enter). Escape abandons the edit.
 *
 * Only commits when the value actually changed, so tabbing through the grid
 * doesn't fire a write per cell.
 */
function KalwatCell({ row, canEdit }: { row: DesignTrackRow; canEdit: boolean }) {
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
        className="border-primary w-20 rounded-[3px] border-2 bg-white px-1.5 py-0.5 text-right text-[13px] font-semibold tabular-nums outline-none dark:bg-slate-900"
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
        'w-20 rounded-[3px] border px-1.5 py-0.5 text-right text-[13px] font-semibold tabular-nums',
        canEdit ? 'cursor-pointer border-amber-300 bg-amber-50/70 hover:border-amber-500 dark:border-amber-400/40 dark:bg-amber-500/10' : 'border-transparent',
        row.kalwat == null && 'text-muted-foreground font-normal',
      )}
    >
      {save.isPending ? <Loader2 className="mx-auto size-3.5 animate-spin" /> : (row.kalwat ?? '—')}
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
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="bg-gradient-brand flex size-9 items-center justify-center rounded-[4px] text-white shadow-md shadow-blue-600/20 ring-1 ring-white/20">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[17px] leading-tight font-bold tracking-tight">Design Track</h2>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            Pending orders filtered by tracked designs
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-[12px] tabular-nums">{data?.total ?? 0} items</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="animate-spin" /> : <RotateCcw />} Refresh
          </Button>
          {can('designtrack:export') && (
            <Button
              size="sm"
              onClick={() =>
                void exportDesignTrack(filters).catch((e) => toast.error(getApiErrorMessage(e, 'Excel export failed')))
              }
            >
              <Download /> Export Excel
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search customer, product, comment…"
            className="h-9 pl-8"
          />
        </div>
        <div className="w-52">
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
        <div className="w-52">
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
        <div className="w-48">
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
          <Button variant="ghost" size="sm" onClick={reset}>
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

      {/* Grid. Header stays put while scrolling the rows. */}
      <div className="max-h-[min(70vh,44rem)] overflow-auto rounded-lg border">
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
                    title="Bags ordered − Dispatched"
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

      {/* Paging */}
      <div className="flex items-center justify-between gap-3">
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

      <p className="text-muted-foreground text-[11px]">
        Kalwat is typed by hand — click the cell, enter the processed quantity, and it saves when you click away.
        Remaining is always <span className="font-semibold">Bags ordered − Dispatched</span> and updates itself.
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

export default DesignTrackPage;
