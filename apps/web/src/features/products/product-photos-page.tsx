import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronLeft, ChevronRight, Images, Loader2, Package, RotateCcw, Search, TriangleAlert } from 'lucide-react';
import type { PhotoGroupBy, ProductPhotoDto, ProductPhotoGroupDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { useDateFormat } from '@/lib/date-format';
import { usePageSize } from '@/hooks/use-page-size';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhotoLightbox, type LinePhoto } from '@/features/orders/line-photos';
import { useProductPhotoFilterOptions, useProductPhotos } from './use-product-photos';

/**
 * Products → Product Photos
 * -------------------------
 * Every photo staff have uploaded against an order line, browsable BY PARTY or
 * BY ITEM.
 *
 * The photos were already there; what was missing was a way in. Until now a
 * photo could only be reached by first knowing which order line it hung off,
 * which makes the two questions people actually ask unanswerable: "what have we
 * made for this party before?" and "what does this item look like?". Grouping
 * the same rows the other way round answers both.
 *
 * Read-only on purpose. Uploading and deleting stay on the screens that own the
 * order line — a gallery with a delete button could strip the reference photo a
 * dispatch depends on, from a screen showing no dispatch context at all.
 */
export function ProductPhotosPage() {
  const { formatDate } = useDateFormat();
  const { page, setPage, pageSize, setPageSize } = usePageSize('product-photos');

  const [groupBy, setGroupBy] = useState<PhotoGroupBy>('PARTY');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [product, setProduct] = useState('');
  const [designType, setDesignType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  /** Which section's photos the viewer is walking, and where in them. */
  const [viewing, setViewing] = useState<{ photos: LinePhoto[]; index: number } | null>(null);

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
    designType: designType || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const { data, isLoading, isFetching } = useProductPhotos({ page, pageSize, groupBy, ...filters });
  const { data: options } = useProductPhotoFilterOptions(filters);

  const groups = data?.groups ?? [];
  const totalPages = data?.totalPages ?? 1;
  const hasFilters = !!(search || customer || product || designType || from || to);
  const reset = () => {
    setSearchInput('');
    setCustomer('');
    setProduct('');
    setDesignType('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  // Switching the grouping re-sections everything, so page 4 of the old
  // sectioning means nothing in the new one.
  const changeGroupBy = (next: PhotoGroupBy) => {
    setGroupBy(next);
    setPage(1);
  };

  /**
   * The viewer walks one SECTION, not one photo — opening a thumbnail in a
   * party's row and arrowing through that party's work is the whole point.
   *
   * The caption is the OTHER axis: grouped by party you already know the party,
   * so the useful line is the item, and vice versa. Raw upload filenames are
   * mostly UUIDs, which name nothing.
   */
  const open = (group: ProductPhotoGroupDto, index: number) =>
    setViewing({
      photos: group.photos.map((p) => ({
        id: p.id,
        url: p.url,
        filename: p.filename,
        mimeType: p.mimeType,
        size: p.size,
        title: captionFor(p, groupBy),
      })),
      index,
    });

  return (
    <div className="space-y-3 font-sans">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="bg-gradient-brand flex size-9 items-center justify-center rounded-[4px] text-white shadow-md shadow-blue-600/20 ring-1 ring-white/20">
          <Images className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[17px] leading-tight font-bold tracking-tight">Product Photos</h2>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            Everything uploaded on an order line, by party and by item
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums dark:bg-white/10">
            {data?.totalPhotos ?? 0}
            <span className="hidden sm:inline"> photos</span>
          </span>
          {isFetching && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
        </div>
      </div>

      {/* ── Group by ────────────────────────────────────────────────────────
          The one control the screen is really about, so it is a visible switch
          rather than another entry in a row of dropdowns. */}
      <div className="flex h-9 w-full items-center gap-1 rounded-[4px] border border-indigo-200 bg-indigo-50/40 p-0.5 sm:w-auto sm:self-start dark:border-indigo-400/30 dark:bg-indigo-500/10">
        {(
          [
            ['PARTY', 'By party', Building2],
            ['ITEM', 'By item', Package],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => changeGroupBy(value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-[3px] px-3 py-1 text-[12px] font-semibold transition-colors sm:flex-none',
              groupBy === value ? 'bg-indigo-600 text-white shadow-sm' : 'text-indigo-900/70 hover:bg-indigo-100 dark:text-indigo-200/80 dark:hover:bg-indigo-500/20',
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────
          Two-up on phones so each control fills its half, inline on desktop —
          same shape as Design Track. */}
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        <div className="relative col-span-2 w-full sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search party, item, design, file…"
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
            placeholder="All parties"
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
            value={designType}
            onChange={(v) => {
              setDesignType(v);
              setPage(1);
            }}
            options={['', ...(options?.designTypes ?? [])]}
            placeholder="All designs"
          />
        </div>
        {/* Uploaded-between, labelled: on a phone there is no column header to
            say which date box is which. */}
        <div className="col-span-2 flex w-full items-center gap-1.5 sm:w-auto">
          <span className="text-muted-foreground shrink-0 text-[11px] font-bold tracking-wide uppercase">Uploaded</span>
          <Input
            type="date"
            className="h-9 min-w-0 flex-1 tabular-nums sm:w-36 sm:flex-none"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
          <span className="text-muted-foreground shrink-0 text-[11px]">to</span>
          <Input
            type="date"
            className="h-9 min-w-0 flex-1 tabular-nums sm:w-36 sm:flex-none"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="col-span-2 h-9 w-full sm:w-auto" onClick={reset}>
            <RotateCcw /> Reset
          </Button>
        )}
      </div>

      {/* The server groups a bounded number of rows per pass. Said out loud,
          rather than showing a subset as though it were the whole answer. */}
      {data?.truncated && (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Too many photos matched to group them all at once — narrow it with a party, item or date range to be sure you
            are seeing everything.
          </span>
        </p>
      )}

      {/* ── The gallery ─────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="text-muted-foreground flex h-40 items-center justify-center rounded-2xl border">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : !groups.length ? (
        <div className="text-muted-foreground rounded-2xl border px-4 py-14 text-center text-sm">
          {hasFilters ? 'No photos match these filters.' : 'No photos have been uploaded against an order line yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <section key={g.key} className="bg-card overflow-hidden rounded-2xl border shadow-sm ring-1 ring-black/[0.02]">
              <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b bg-gradient-to-r from-indigo-50 to-white px-3 py-2 dark:from-indigo-500/10 dark:to-transparent">
                <h3 className="min-w-0 text-[14px] leading-tight font-extrabold break-words text-slate-900 dark:text-slate-100">
                  {g.label}
                </h3>
                {g.subLabel && <span className="text-muted-foreground text-[11px] font-medium">{g.subLabel}</span>}
              </header>

              {/* Three across on the narrowest phone: big enough to recognise a
                  design, small enough that a party's work is one glance. */}
              <div className="grid grid-cols-3 gap-2 p-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                {g.photos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => open(g, i)}
                    className="group focus-visible:ring-ring block text-left focus-visible:ring-2 focus-visible:outline-none"
                    title={`${p.customerName} · ${p.productName || p.product || '—'}`}
                  >
                    <div className="relative aspect-square overflow-hidden rounded-lg border bg-slate-100 dark:bg-white/5">
                      <img
                        src={p.url}
                        alt={captionFor(p, groupBy)}
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    </div>
                    {/* Two lines, never truncated to nothing: the other axis
                        (the thing you do NOT already know from the heading),
                        then when it was taken. */}
                    <p className="mt-1 text-[10.5px] leading-tight font-semibold break-words text-slate-700 dark:text-slate-300">
                      {captionFor(p, groupBy)}
                    </p>
                    <p className="text-muted-foreground text-[9.5px] font-medium tabular-nums">{formatDate(p.uploadedAt)}</p>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Paging (over sections, so a party is never split in two) ────────── */}
      {groups.length > 0 && (
        <div className="bg-card flex items-center gap-2 rounded-xl border px-2.5 py-1.5 shadow-sm sm:justify-between">
          <span className="text-muted-foreground text-[11.5px] font-medium">
            <span className="text-foreground font-bold tabular-nums">{data?.totalGroups ?? 0}</span>{' '}
            {groupBy === 'PARTY' ? 'parties' : 'items'}
          </span>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            <PageSizeSelect value={pageSize} onChange={setPageSize} hideLabel />
            <span className="text-[11.5px] font-bold tabular-nums whitespace-nowrap">
              {data?.page ?? page}/{totalPages}
            </span>
            <div className="flex gap-1.5">
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

      {viewing && (
        <PhotoLightbox
          photos={viewing.photos}
          index={viewing.index}
          onIndex={(index) => setViewing((prev) => (prev ? { ...prev, index } : null))}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/**
 * The half of the identity the section heading does NOT already give you.
 *
 * Under a party heading every photo shares the party, so repeating it on each
 * thumbnail is noise — the item is what distinguishes them. Under an item
 * heading it is the other way round.
 */
function captionFor(p: ProductPhotoDto, groupBy: PhotoGroupBy): string {
  if (groupBy === 'PARTY') {
    const item = p.productName || p.product || '—';
    return p.designName && p.designName !== item ? `${item} · ${p.designName}` : item;
  }
  return p.customerName;
}

export default ProductPhotosPage;
