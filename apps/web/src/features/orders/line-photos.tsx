/**
 * Order-line photo manager + lightbox viewer, shared by the Order form (draft
 * mode — photos travel in the order save payload) and by Order Modify / Dispatch
 * (live mode — the line already exists, so photos attach/detach immediately).
 *
 * The visual grid + full-screen animated lightbox are shared; only where the
 * photos live differs between the two wrappers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  ImagePlus,
  Loader2,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import { toast } from 'sonner';
import type { OrderItemPhotoInput } from '@oms/shared';
import { getApiErrorMessage, uploadFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { useAddOrderItemPhoto, useDeleteOrderItemPhoto, useOrderItemPhotos } from './use-orders';

/** A photo in the manager — existing ones carry `id`, new uploads carry `path`. */
export interface LinePhoto {
  id?: number;
  url: string;
  path?: string;
  filename?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

/** Convert draft photos to the order-line input shape sent on save. */
export function toPhotoInput(photos: LinePhoto[]): OrderItemPhotoInput[] {
  return photos.map((p) => ({
    id: p.id ?? undefined,
    path: p.path ?? undefined,
    url: p.url,
    filename: p.filename ?? undefined,
    mimeType: p.mimeType ?? undefined,
    size: p.size ?? undefined,
  }));
}

const photoKeyOf = (p: LinePhoto) => (p.id != null ? `id:${p.id}` : `url:${p.url}`);
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/heic,image/heif';
const MAX_BYTES = 8 * 1024 * 1024;

// One-off keyframes for the lightbox — richer than the tailwind-animate presets.
const LIGHTBOX_CSS = `
.lp-backdrop { animation: lp-fade .22s ease-out both; }
.lp-stage { animation: lp-pop .3s cubic-bezier(.16,1,.3,1) both; }
.lp-thumb-in { animation: lp-thumb .35s cubic-bezier(.16,1,.3,1) both; }
@keyframes lp-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes lp-pop { from { opacity: 0; transform: scale(.92) translateY(10px) } to { opacity: 1; transform: none } }
@keyframes lp-thumb { from { opacity: 0; transform: translateY(8px) scale(.9) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) {
  .lp-backdrop, .lp-stage, .lp-thumb-in { animation: none !important; }
}`;

// ── Shared presentational manager ──────────────────────────────────────────────

function PhotoManager({
  photos,
  canEdit = true,
  busy = false,
  onAddFiles,
  onRemove,
  title = 'Photos',
  emptyHint = 'No photos yet.',
}: {
  photos: LinePhoto[];
  canEdit?: boolean;
  busy?: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (photo: LinePhoto) => void;
  title?: string;
  emptyHint?: string;
}) {
  const [viewer, setViewer] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files: File[] = [];
    for (const f of Array.from(list)) {
      if (!f.type.startsWith('image/')) {
        toast.error(`${f.name}: only image files can be added.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name}: image is larger than 8 MB.`);
        continue;
      }
      files.push(f);
    }
    if (files.length) onAddFiles(files);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <Camera className="size-3.5" /> {title}
          {photos.length > 0 && (
            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-indigo-700">
              {photos.length}
            </span>
          )}
        </span>
      </div>

      <div
        className={cn(
          'grid grid-cols-4 gap-2 sm:grid-cols-5',
          dragOver && 'rounded-lg outline-2 outline-dashed outline-indigo-400',
        )}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragOver(false);
          pickFiles(e.dataTransfer.files);
        }}
      >
        {photos.map((p, i) => (
          <div
            key={photoKeyOf(p)}
            className="group lp-thumb-in relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm ring-1 ring-transparent transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-indigo-300"
            style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
          >
            <button
              type="button"
              onClick={() => setViewer(i)}
              className="block size-full cursor-zoom-in"
              title={p.filename ?? 'View photo'}
            >
              <img src={p.url} alt={p.filename ?? `Photo ${i + 1}`} loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-110" />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
              <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/40 px-1 py-0.5 text-[10px] font-medium text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
                <ZoomIn className="size-3" /> View
              </span>
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => onRemove(p)}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-white/90 text-rose-600 opacity-0 shadow-sm ring-1 ring-black/5 transition-all duration-200 hover:scale-110 hover:bg-rose-600 hover:text-white group-hover:opacity-100"
                aria-label="Remove photo"
                title="Remove photo"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}

        {canEdit && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className={cn(
              'group relative flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-indigo-300 bg-gradient-to-br from-indigo-50 to-sky-50 text-indigo-500 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-400 hover:from-indigo-100 hover:to-sky-100 hover:text-indigo-600 hover:shadow-md disabled:cursor-wait disabled:opacity-70',
            )}
            title="Add photo(s)"
          >
            {busy ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <>
                <ImagePlus className="size-6 transition-transform duration-200 group-hover:scale-110" />
                <span className="text-[10px] font-semibold">Add</span>
              </>
            )}
          </button>
        )}
      </div>

      {photos.length === 0 && !canEdit && (
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <ImageOff className="size-3.5" /> {emptyHint}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          pickFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {viewer !== null && photos[viewer] && (
        <PhotoLightbox photos={photos} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

// ── Full-screen animated lightbox ──────────────────────────────────────────────

function PhotoLightbox({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: LinePhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(false);
  const photo = photos[index];
  const go = useCallback(
    (dir: -1 | 1) => {
      setZoom(false);
      onIndex((index + dir + photos.length) % photos.length);
    },
    [index, photos.length, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    // Lock body scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  if (!photo) return null;

  return createPortal(
    <div
      className="lp-backdrop fixed inset-0 z-[200] flex flex-col bg-slate-950/90 backdrop-blur-md"
      onClick={onClose}
    >
      <style>{LIGHTBOX_CSS}</style>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{photo.filename ?? `Photo ${index + 1}`}</p>
          <p className="text-xs text-white/60">
            {index + 1} of {photos.length}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={photo.url}
            download={photo.filename ?? true}
            target="_blank"
            rel="noreferrer"
            className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            title="Download / open"
          >
            <Download className="size-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-rose-500"
            title="Close (Esc)"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-2" onClick={(e) => e.stopPropagation()}>
        {photos.length > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            className="absolute left-3 z-10 flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/25"
            title="Previous (←)"
          >
            <ChevronLeft className="size-6" />
          </button>
        )}

        <img
          key={photo.url}
          src={photo.url}
          alt={photo.filename ?? `Photo ${index + 1}`}
          onClick={() => setZoom((z) => !z)}
          className={cn(
            'lp-stage max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-300',
            zoom ? 'scale-150 cursor-zoom-out' : 'cursor-zoom-in',
          )}
        />

        {photos.length > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            className="absolute right-3 z-10 flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/25"
            title="Next (→)"
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>

      {/* Filmstrip */}
      {photos.length > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {photos.map((p, i) => (
            <button
              key={photoKeyOf(p)}
              type="button"
              onClick={() => {
                setZoom(false);
                onIndex(i);
              }}
              className={cn(
                'size-14 shrink-0 overflow-hidden rounded-lg ring-2 transition-all',
                i === index ? 'scale-105 ring-indigo-400' : 'opacity-60 ring-transparent hover:opacity-100',
              )}
            >
              <img src={p.url} alt={p.filename ?? `Photo ${i + 1}`} className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

// ── Draft mode (Order form — photos held locally, saved with the order) ─────────

export function DraftLinePhotos({
  value,
  onChange,
  canEdit = true,
}: {
  value: LinePhoto[];
  onChange: (photos: LinePhoto[]) => void;
  canEdit?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  const addFiles = async (files: File[]) => {
    setBusy(true);
    try {
      const uploaded: LinePhoto[] = [];
      for (const f of files) {
        const up = await uploadFile(f);
        uploaded.push({ url: up.url, path: up.path, filename: up.filename, mimeType: up.mimeType, size: up.size });
      }
      onChange([...valueRef.current, ...uploaded]);
      toast.success(`${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} added`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = (photo: LinePhoto) => onChange(valueRef.current.filter((p) => photoKeyOf(p) !== photoKeyOf(photo)));

  return (
    <PhotoManager
      photos={value}
      canEdit={canEdit}
      busy={busy}
      onAddFiles={addFiles}
      onRemove={remove}
      title="Line photos"
      emptyHint="No photos on this line."
    />
  );
}

// ── Live mode (Order Modify & Dispatch — the line exists; changes are immediate) ─

export function LiveLinePhotos({
  orderItemId,
  canEdit = true,
  title = 'Line photos',
}: {
  orderItemId: number;
  canEdit?: boolean;
  title?: string;
}) {
  const confirm = useConfirm();
  const { data: photos = [], isLoading } = useOrderItemPhotos(orderItemId);
  const add = useAddOrderItemPhoto(orderItemId);
  const del = useDeleteOrderItemPhoto(orderItemId);
  const [busy, setBusy] = useState(false);

  const addFiles = async (files: File[]) => {
    setBusy(true);
    try {
      for (const f of files) {
        const up = await uploadFile(f);
        await add.mutateAsync(up);
      }
      toast.success(`${files.length} photo${files.length === 1 ? '' : 's'} added`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (photo: LinePhoto) => {
    if (photo.id == null) return;
    const ok = await confirm({
      title: 'Remove this photo?',
      description: 'The photo will be permanently deleted from this order line.',
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(photo.id, { onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')) });
  };

  if (isLoading) {
    return (
      <div className="flex h-16 items-center justify-center text-slate-400">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <PhotoManager
      photos={photos}
      canEdit={canEdit}
      busy={busy}
      onAddFiles={addFiles}
      onRemove={remove}
      title={title}
      emptyHint="No photos on this line."
    />
  );
}
