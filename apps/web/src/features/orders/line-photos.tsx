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
import { useAuthStore } from '@/stores/auth-store';
import { isAdminRole } from '@oms/shared';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/common/confirm';
import { looksLikeImage, prepareImageForUpload } from '@/lib/image-prep';
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
  /**
   * Human caption for the viewer, when the file name says nothing useful — an
   * upload called "0249a195-c95a-4e0d-….jpeg" tells you nothing, "ANIL METAL ·
   * 10 BREZZA WL+LOGO" tells you everything. Display only: the download still
   * uses the real `filename`.
   */
  title?: string | null;
  /** Email of whoever uploaded it — the delete control is theirs alone. */
  uploadedBy?: string | null;
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
/** `image/*` leads deliberately: Android Chrome greys out gallery providers that
 *  don't declare one of the explicit MIME types, so an explicit-only list made
 *  most gallery apps unusable. The specific types stay for desktop pickers,
 *  which show friendlier filtering when they're named. */
const IMAGE_ACCEPT = 'image/*,image/png,image/jpeg,image/gif,image/webp,image/bmp,image/heic,image/heif';
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
  canDelete,
  busy = false,
  onAddFiles,
  onRemove,
  title = 'Photos',
  emptyHint = 'No photos yet.',
  hideHeader = false,
  gridClassName = 'grid-cols-4 gap-2 sm:grid-cols-5',
}: {
  photos: LinePhoto[];
  /** Governs adding new photos (drag/drop + the Add tile). */
  canEdit?: boolean;
  /** Governs the per-photo delete button — defaults to `canEdit` so existing
   *  callers keep their current behaviour. Pass separately wherever adding and
   *  deleting need different rules (e.g. Modify Dispatch: view for everyone,
   *  delete for super admins only; Dispatch Order: add allowed, delete never). */
  /**
   * Who may delete, per photo.
   *
   * A single flag could only ever say "this viewer may delete everything here or
   * nothing", which is what let any operator clear a photo somebody else had
   * attached. A predicate lets the caller answer it per tile — see LiveLinePhotos,
   * where the answer is "only the one you uploaded".
   */
  canDelete?: boolean | ((photo: LinePhoto) => boolean);
  busy?: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (photo: LinePhoto) => void;
  title?: string;
  emptyHint?: string;
  /** Skip the built-in title/count row — for callers that already show it
   *  themselves (e.g. a collapsible section header). */
  hideHeader?: boolean;
  /** Column/gap classes for the thumbnail grid. Fewer columns = bigger tiles;
   *  the default suits the wide in-page/dialog views, while a narrow popover
   *  wants fewer, larger tiles so a reference photo is actually readable. */
  gridClassName?: string;
}) {
  const allowDelete = (p: LinePhoto) =>
    typeof canDelete === 'function' ? canDelete(p) : (canDelete ?? canEdit);
  const [viewer, setViewer] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Takes a real File[] rather than a live FileList: resetting the input's
  // `value` (needed so re-picking the same photo fires onChange again) empties
  // the FileList object itself, which would leave this async function reading
  // zero files. Callers snapshot before clearing.
  const pickFiles = async (list: File[]) => {
    if (list.length === 0) return;
    const files: File[] = [];
    for (const f of list) {
      // `looksLikeImage`, not `type.startsWith('image/')`: Android's own pickers
      // commonly return an empty `type`, which the old check rejected outright —
      // so picking a gallery photo on Android silently did nothing.
      if (!looksLikeImage(f)) {
        toast.error(`${f.name || 'That file'}: only image files can be added.`);
        continue;
      }
      // Shrink big camera photos rather than refusing them — a phone JPEG is
      // routinely over the 8 MB cap that used to reject it outright.
      const prepared = await prepareImageForUpload(f);
      if (prepared.size > MAX_BYTES) {
        toast.error(`${f.name}: still larger than 8 MB after resizing — please pick a smaller image.`);
        continue;
      }
      files.push(prepared);
    }
    if (files.length) onAddFiles(files);
  };

  return (
    <div className="space-y-2">
      {!hideHeader && (
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
      )}

      <div
        className={cn(
          'grid',
          gridClassName,
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
          void pickFiles(e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []);
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
              <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/40 px-1 py-0.5 text-[10px] font-medium text-white opacity-100 backdrop-blur-sm transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
                <ZoomIn className="size-3" /> View
              </span>
            </button>
            {allowDelete(p) && (
              <button
                type="button"
                onClick={() => onRemove(p)}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-white/90 text-rose-600 opacity-100 shadow-sm ring-1 ring-black/5 transition-all duration-200 hover:scale-110 hover:bg-rose-600 hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
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
          // Snapshot BEFORE clearing — see the note on pickFiles.
          const picked = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = '';
          void pickFiles(picked);
        }}
      />

      {viewer !== null && photos[viewer] && (
        <PhotoLightbox photos={photos} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

// ── Full-screen animated lightbox ──────────────────────────────────────────────

// ── Full-screen animated lightbox ──────────────────────────────────────────────

export function PhotoLightbox({
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
      className="lp-backdrop fixed inset-0 z-[9999] flex flex-col bg-slate-950/95 backdrop-blur-md"
      onClick={onClose}
    >
      <style>{LIGHTBOX_CSS}</style>

      {/* Floating Close Button at top-right — always visible on top of everything */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="fixed top-4 right-4 z-[10000] flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xl ring-1 ring-white/30 transition-all hover:scale-105 hover:bg-rose-600 hover:ring-rose-400 cursor-pointer"
        title="Close photo viewer (Esc)"
      >
        <X className="size-4" />
        <span>Close</span>
      </button>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 pr-28 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{photo.title ?? photo.filename ?? `Photo ${index + 1}`}</p>
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
  gridClassName,
}: {
  value: LinePhoto[];
  onChange: (photos: LinePhoto[]) => void;
  canEdit?: boolean;
  /** See {@link PhotoManager} — lets the order form's narrow popover show
   *  fewer, larger tiles than the default in-page grid. */
  gridClassName?: string;
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
      gridClassName={gridClassName}
    />
  );
}

// ── Live mode (Order Modify & Dispatch — the line exists; changes are immediate) ─

export function LiveLinePhotos({
  orderItemId,
  canEdit = true,
  canDelete,
  title = 'Line photos',
  hideHeader = false,
  gridClassName,
}: {
  orderItemId: number;
  canEdit?: boolean;
  /** See the note on PhotoManager — defaults to `canEdit` when omitted. */
  canDelete?: boolean | ((photo: LinePhoto) => boolean);
  title?: string;
  hideHeader?: boolean;
  /** See {@link PhotoManager} — fewer, larger tiles for narrow phone viewers. */
  gridClassName?: string;
}) {
  const confirm = useConfirm();
  // Your own photo, or anyone's if you are an admin. The server enforces this
  // (see OrdersService.deletePhoto) — hiding the control here just stops offering
  // an action that would be refused, and keeps someone else's reference photo
  // from looking like it is the current user's to discard. Matched on email,
  // case-insensitively: the stored values are inconsistently cased. Admins are
  // also the only ones who can clear photos with no recorded uploader.
  const me = useAuthStore((st) => st.user?.email)?.trim().toLowerCase();
  const admin = isAdminRole(useAuthStore((st) => st.user?.roles));
  const mayRemove = (photo: LinePhoto) => {
    if (admin) return true;
    const owner = photo.uploadedBy?.trim().toLowerCase();
    return !!owner && !!me && owner === me;
  };
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
      // Narrows, never widens: a caller that already said "no deleting here"
      // (challan-form-page passes canEdit={false}) keeps its answer.
      canDelete={(photo) => {
        const allowedByCaller = typeof canDelete === 'function' ? canDelete(photo) : (canDelete ?? canEdit);
        return allowedByCaller && mayRemove(photo);
      }}
      busy={busy}
      onAddFiles={addFiles}
      onRemove={remove}
      title={title}
      emptyHint="No photos on this line."
      hideHeader={hideHeader}
      gridClassName={gridClassName}
    />
  );
}
