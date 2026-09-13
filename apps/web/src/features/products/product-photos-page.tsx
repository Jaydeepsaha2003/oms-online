import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Image as ImageIcon,
  ImageOff,
  Images,
  Loader2,
  Lock,
  Package,
  RotateCcw,
  Search,
  TriangleAlert,
} from 'lucide-react';
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
        {/* Softer, larger radius than the app's usual 4px chip — the mockup
            treats this page as a gallery rather than a worksheet, and the
            rounded tile is what sets that tone from the first element. */}
        <div className="flex size-[34px] flex-none items-center justify-center rounded-[9px] bg-indigo-600 text-white shadow-[0_4px_12px_rgba(79,70,229,0.28)] ring-1 ring-white/25 ring-inset">
          <Images className="size-[19px]" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[19px] leading-tight font-semibold tracking-[-0.015em]">Product Photos</h2>
          <p className="text-muted-foreground truncate text-[12.5px] leading-tight font-medium">
            Everything uploaded on an order line, by party and by item
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isFetching && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
          {/* Read-only is a fact about the whole screen, so it is stated once
              here rather than implied by the absence of buttons. */}
          <span className="text-muted-foreground hidden items-center gap-1.5 rounded-[8px] border bg-slate-50 px-2.5 py-1.5 text-[11.5px] font-medium sm:flex dark:bg-white/5">
            <Lock className="size-3.5" /> Read-only
          </span>
          <span className="flex items-center gap-1.5 rounded-[8px] border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-500/10 dark:text-indigo-300">
            <ImageIcon className="size-3.5" />
            <b className="text-[12.5px] font-semibold tabular-nums">{data?.totalPhotos ?? 0}</b>
            <span className="hidden text-[11.5px] font-medium sm:inline">photos</span>
          </span>
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
        <div className="col-span-2 flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          <span className="text-muted-foreground shrink-0 text-[11px] font-bold tracking-wide uppercase">Uploaded</span>
          {/*
            A native date input has an intrinsic width — the dd-mm-yyyy segments
            plus the picker button. `flex-1 min-w-0` let it shrink below that, so
            the segments clipped and collided with the calendar icon, which is
            what read as a formatting/alignment fault. Give it a width that fits
            its own content and let the ROW wrap on a narrow screen instead of
            crushing the fields.
          */}
          <Input
            type="date"
            aria-label="Uploaded from"
            className="h-9 w-[8.75rem] shrink-0 px-2 tabular-nums"
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
            aria-label="Uploaded to"
            className="h-9 w-[8.75rem] shrink-0 px-2 tabular-nums"
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
        <div className="text-muted-foreground bg-card flex h-40 items-center justify-center rounded-xl border">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : !groups.length ? (
        <div className="bg-card rounded-xl border border-dashed px-6 py-14 text-center sm:py-16">
          <ImageOff className="text-muted-foreground/50 mx-auto size-8" />
          <p className="mt-2.5 text-[13.5px] font-semibold text-slate-700 dark:text-slate-300">
            {hasFilters ? 'No photos match these filters.' : 'No photos uploaded yet.'}
          </p>
          <p className="text-muted-foreground mt-1 text-[12px]">
            {hasFilters
              ? 'Clear the search or widen the dates to see more.'
              : 'Photos attached to an order line show up here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <section
              key={g.key}
              className="bg-card overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(28,26,23,0.04),0_8px_24px_-18px_rgba(28,26,23,0.18)]"
            >
              <header className="flex items-center gap-2.5 border-b bg-gradient-to-b from-slate-50/80 to-slate-100/60 px-3.5 py-3 sm:gap-3 sm:px-[18px] dark:from-white/[0.04] dark:to-transparent">
                {/* Monogram: a fixed anchor at the same spot on every card, so a
                    long scroll has something to track other than the text. */}
                <span className="flex size-[30px] flex-none items-center justify-center rounded-[8px] border border-indigo-200 bg-indigo-50 font-mono text-[11px] font-semibold text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-500/10 dark:text-indigo-300">
                  {initialsOf(g.label)}
                </span>
                {/* Baseline-aligned on desktop so the name and its count read as
                    one line; stacked on a phone, where the name alone can wrap
                    to two and a trailing count would strand itself. */}
                <div className="flex min-w-0 flex-1 flex-col gap-y-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2.5">
                  <h3 className="min-w-0 text-[13.5px] leading-tight font-semibold tracking-[-0.01em] break-words text-slate-900 sm:text-[14.5px] dark:text-slate-100">
                    {g.label}
                  </h3>
                  <span className="text-muted-foreground font-mono text-[10.5px] whitespace-nowrap sm:text-[11px]">
                    {metaFor(g, groupBy)}
                  </span>
                </div>
                {/* The newest upload in the card. Photos arrive newest-first, so
                    it is simply the first one — no scan needed. */}
                {g.photos[0] && (
                  <span className="text-muted-foreground ml-auto hidden flex-none items-center gap-1.5 font-mono text-[10.5px] whitespace-nowrap sm:flex">
                    <Clock className="size-3.5" />
                    {formatDate(g.photos[0].uploadedAt)}
                  </span>
                )}
              </header>

              {/*
               * Two across on the narrowest phone, then as many ~124px tiles as
               * fit. The old fixed 3/4/6/8 columns made a tile on a phone about
               * 100px — too small to tell two laser designs apart, which is the
               * one thing this page exists for. `auto-fill` also stops a wide
               * monitor stretching six photos across the full width.
               *
               * A desktop tile is deliberately a little smaller than the photo
               * it holds needs to be readable: the caption underneath is what
               * people scan, so the row fits more of them and the text below
               * carries the weight.
               */}
              <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-[repeat(auto-fill,minmax(124px,1fr))] sm:gap-3.5 sm:p-[18px]">
                {g.photos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => open(g, i)}
                    className="group focus-visible:ring-ring flex flex-col gap-2 rounded-[10px] text-left focus-visible:ring-2 focus-visible:outline-none"
                    title={`${p.customerName} · ${p.productName || p.product || '—'}`}
                  >
                    {/*
                     * The hatch is the placeholder, and it is on the CONTAINER
                     * rather than a separate element — it shows through while
                     * the photo streams in and stays put if the file is missing,
                     * instead of the flat grey box that reads as a broken page.
                     */}
                    <div className="relative aspect-square overflow-hidden rounded-[10px] border bg-[repeating-linear-gradient(135deg,#f1f5f9_0_7px,#e2e8f0_7px_14px)] shadow-sm transition-[transform,box-shadow] duration-200 ease-out group-hover:-translate-y-[3px] group-hover:shadow-[0_10px_22px_-10px_rgba(28,26,23,0.3)] dark:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.05)_0_7px,rgba(255,255,255,0.09)_7px_14px)]">
                      <ImageIcon className="text-muted-foreground/45 absolute top-1/2 left-1/2 size-[22px] -translate-x-1/2 -translate-y-1/2" />
                      {/* onError hides a missing file rather than letting the
                          browser paint its broken-image glyph and the alt text
                          across the tile: the hatch behind then shows through,
                          so a gap in the uploads folder reads as "not here yet"
                          instead of as a broken page. */}
                      <img
                        src={p.url}
                        alt={captionFor(p, groupBy)}
                        loading="lazy"
                        onError={(e) => e.currentTarget.classList.add('invisible')}
                        className="relative size-full object-cover"
                      />
                    </div>
                    {/* Two lines: the other axis (what the heading does NOT
                        already tell you), then when it was taken. */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] leading-[1.3] font-semibold break-words text-slate-700 dark:text-slate-300">
                        {captionFor(p, groupBy)}
                      </span>
                      <span className="text-muted-foreground font-mono text-[11.5px]">{formatDate(p.uploadedAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Paging (over sections, so a party is never split in two) ────────── */}
      {groups.length > 0 && (
        <div className="bg-card flex items-center gap-2 rounded-[10px] border px-3 py-2 shadow-[0_1px_2px_rgba(28,26,23,0.04)] sm:justify-between">
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
 * Two-letter monogram for a group's avatar — "SANCHETI STEEL HOUSE" -> "SS".
 *
 * Punctuation is stripped first so "MANGAL & MANGAL" reads MM rather than M&.
 * The avatar exists to give each card a fixed anchor the eye can find while
 * scrolling a long page; the letters only have to be recognisable next to the
 * name, not unique on their own.
 */
function initialsOf(label: string): string {
  return (
    label
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '—'
  );
}

/**
 * "6 photos · 4 items" — how much is in this card, and across how many of the
 * OTHER axis.
 *
 * The server's own `subLabel` says only the second half; the count of photos is
 * what tells you whether a card is worth opening, and it is the first thing
 * anyone asks of a group heading.
 */
function metaFor(group: ProductPhotoGroupDto, groupBy: PhotoGroupBy): string {
  const n = group.photos.length;
  const others = new Set(
    group.photos.map((p) => (groupBy === 'PARTY' ? p.productName || p.product || '—' : p.customerName)),
  ).size;
  const noun = groupBy === 'PARTY' ? 'item' : 'party';
  const plural = groupBy === 'PARTY' ? 'items' : 'parties';
  return `${n} ${n === 1 ? 'photo' : 'photos'} · ${others} ${others === 1 ? noun : plural}`;
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
