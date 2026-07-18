import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, ImageOff, ImagePlus, Loader2, Pencil, Plus, Search, Trash2, X, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import type { DesignNameDto } from '@oms/shared';
import { getApiErrorMessage, uploadFile } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  exportDesignNames,
  useCreateDesignName,
  useDeleteDesignName,
  useDesignNames,
  useImportDesignNames,
  useUpdateDesignName,
} from './use-design-names';

// This is a small master-data lookup (a few hundred rows) grouped by design
// type, so we fetch the whole matching set in one page instead of paginating —
// splitting a group across pages would be a worse experience than one big list.
const PAGE_SIZE = 2000;

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/heic,image/heif';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function DesignNamesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<DesignNameDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page: 1, pageSize: PAGE_SIZE, search: search || undefined };
  const { data, isLoading } = useDesignNames(query);
  const del = useDeleteDesignName();
  const importMut = useImportDesignNames();

  const items = data?.items ?? [];

  // Group by design type. The server already sorts designType asc, then
  // designName asc, so a Map preserves exactly that order with no extra work.
  const groups = useMemo(() => {
    const map = new Map<string, DesignNameDto[]>();
    for (const d of items) {
      const key = d.designType || '—';
      const bucket = map.get(key);
      if (bucket) bucket.push(d);
      else map.set(key, [d]);
    }
    return [...map.entries()];
  }, [items]);

  const toggleGroup = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allCollapsed = groups.length > 0 && groups.every(([key]) => collapsed.has(key));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map(([key]) => key)));

  const handleDelete = async (d: DesignNameDto) => {
    const ok = await confirm({
      title: 'Delete design name?',
      description: `"${d.designType}" → "${d.designName}" will be removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(d.id, {
      onSuccess: () => toast.success('Design name deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const handleImport = async (file: File) => {
    try {
      const rows = await parseExcelFile(file);
      const res = await importMut.mutateAsync(rows);
      const skipped = res.errors.length ? `, ${res.errors.length} skipped` : '';
      toast.success(`Imported: ${res.created} created, ${res.updated} updated${skipped}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Import failed'));
    }
  };

  const canEdit = can('designname:update');
  const canDelete = can('designname:delete');
  const rowActions = (d: DesignNameDto) => (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {canEdit && (
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(d)} aria-label="Edit">
          <Pencil className="size-4" />
        </Button>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:text-destructive"
          onClick={() => handleDelete(d)}
          aria-label="Delete"
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  );

  // Small thumbnail used in both the desktop table and mobile cards — always
  // `object-contain` (never `cover`) so the photo is scaled down as-is, with
  // its full frame visible and aspect ratio intact: shrunk, never cropped or
  // stretched. Opens the full-resolution lightbox on click.
  const thumb = (d: DesignNameDto, size: string) =>
    d.photoUrl ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setLightbox({ url: d.photoUrl!, name: d.designName });
        }}
        className={cn('group relative shrink-0 overflow-hidden rounded-md border bg-muted/40', size)}
        title="View photo"
      >
        <img src={d.photoUrl} alt={d.designName} loading="lazy" className="size-full object-contain" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/25 group-hover:opacity-100">
          <ZoomIn className="size-3.5 text-white" />
        </span>
      </button>
    ) : (
      <div className={cn('text-muted-foreground/40 flex shrink-0 items-center justify-center rounded-md border border-dashed', size)}>
        <ImageOff className="size-4" />
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Design Names</h2>
          <p className="text-muted-foreground text-sm">
            {data?.total ?? 0} records · {groups.length} design type{groups.length === 1 ? '' : 's'} · maps a design-type code to a readable name
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('designname:export') && <ExportButton onClick={() => exportDesignNames(query)} />}
          {can('designname:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
          {can('designname:create') && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New design name
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-[12rem]">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search design type or name…"
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        {groups.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={toggleAll} className="shrink-0">
            {allCollapsed ? <ChevronDown /> : <ChevronUp />} {allCollapsed ? 'Expand all' : 'Collapse all'}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-muted-foreground flex h-32 items-center justify-center rounded-lg border bg-card">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border bg-card px-4 py-10 text-center text-sm">No design names yet.</div>
      ) : (
        <>
          {/* Desktop/tablet: one sectioned table — a group header row per design
              type (click to collapse) followed by its design names + photos. */}
          <div className="hidden overflow-hidden rounded-[5px] border bg-card shadow-sm sm:block">
            <table className="w-full text-[15px]">
              <thead className="bg-gradient-to-b from-blue-800 to-indigo-800 text-white">
                <tr className="[&>th]:px-5 [&>th]:py-2 [&>th]:text-left [&>th]:text-[14px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-wider">
                  <th className="w-16">Photo</th>
                  <th>Design name</th>
                  <th>Last updated</th>
                  <th className="w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([designType, rows]) => {
                  const isCollapsed = collapsed.has(designType);
                  return (
                    <Fragment key={designType}>
                      <tr className="bg-muted/70 border-t">
                        <td colSpan={4} className="px-5 py-1.5">
                          <button
                            type="button"
                            onClick={() => toggleGroup(designType)}
                            className="hover:text-primary flex w-full items-center gap-2 text-left font-semibold"
                          >
                            <ChevronDown className={cn('size-4 shrink-0 transition-transform', isCollapsed && '-rotate-90')} />
                            <span className="uppercase tracking-wide">{designType}</span>
                            <span className="text-muted-foreground text-xs font-normal">
                              {rows.length} name{rows.length === 1 ? '' : 's'}
                            </span>
                          </button>
                        </td>
                      </tr>
                      {!isCollapsed &&
                        rows.map((d, idx) => (
                          <tr
                            key={d.id}
                            className={cn('hover:bg-muted border-b last:border-b-0', idx % 2 === 1 && 'bg-slate-50', canEdit && 'cursor-pointer')}
                            onClick={canEdit ? () => setEditing(d) : undefined}
                          >
                            <td className="px-5 py-1.5">{thumb(d, 'size-10')}</td>
                            <td className="px-5 py-1.5 font-medium">{d.designName}</td>
                            <td className="text-muted-foreground px-5 py-1.5 whitespace-nowrap font-mono text-xs" title={formatDateTime(d.updatedAt)}>
                              {formatDateShort(d.updatedAt)}
                            </td>
                            <td className="px-5 py-1.5 text-right">{rowActions(d)}</td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: one collapsible card per design type, its names + photos stacked inside. */}
          <div className="space-y-3 sm:hidden">
            {groups.map(([designType, rows]) => {
              const isCollapsed = collapsed.has(designType);
              return (
                <div key={designType} className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleGroup(designType)}
                    className="flex w-full items-center gap-2 bg-gradient-to-r from-blue-800 to-indigo-800 px-3 py-2 text-left text-white"
                  >
                    <ChevronDown className={cn('size-4 shrink-0 transition-transform', isCollapsed && '-rotate-90')} />
                    <span className="font-bold uppercase tracking-wide">{designType}</span>
                    <span className="ml-auto shrink-0 text-xs font-normal text-white/75">
                      {rows.length} name{rows.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y">
                      {rows.map((d) => (
                        <div key={d.id} className="flex items-start gap-3 p-3" onClick={canEdit ? () => setEditing(d) : undefined}>
                          {thumb(d, 'size-12')}
                          <div className="min-w-0 flex-1">
                            <p className="leading-tight font-medium">{d.designName}</p>
                            <p className="text-muted-foreground mt-0.5 font-mono text-[11px]" title={formatDateTime(d.updatedAt)}>
                              {formatDateShort(d.updatedAt)}
                            </p>
                            <div className="mt-2 flex items-center justify-end gap-1 border-t pt-2">{rowActions(d)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {(creating || editing) && (
        <DesignNameDialog
          designName={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {lightbox && <DesignPhotoLightbox url={lightbox.url} name={lightbox.name} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/** Full-resolution, undistorted photo view — the image is never scaled up past
 *  its natural size and never cropped, just fit inside the viewport. */
function DesignPhotoLightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-slate-950/90 backdrop-blur-md" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="truncate text-sm font-semibold">{name}</p>
        <button
          type="button"
          onClick={onClose}
          className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-rose-500"
          title="Close (Esc)"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden px-4 pb-6" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
      </div>
    </div>,
    document.body,
  );
}

/** A single reference-photo slot: upload, preview, replace, remove. The file
 *  is sent to the server exactly as picked — no client-side resize/re-encode —
 *  so the stored image keeps its original resolution and quality untouched. */
function DesignPhotoField({
  photo,
  onChange,
}: {
  photo: { path: string; url: string } | null;
  onChange: (photo: { path: string; url: string } | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Only image files can be added.');
    if (file.size > MAX_PHOTO_BYTES) return toast.error('Image is larger than 8 MB.');
    setBusy(true);
    try {
      const up = await uploadFile(file, undefined, 'design-names');
      onChange({ path: up.path, url: up.url });
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>Reference photo</Label>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-muted/30 transition-colors',
            dragOver && !busy ? 'border-primary bg-primary/5' : 'border-border',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          {busy ? (
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          ) : photo ? (
            <>
              <img src={photo.url} alt="Design reference" className="size-full object-contain p-1" />
              <button
                type="button"
                onClick={() => onChange(null)}
                className="bg-background/90 text-destructive hover:bg-destructive absolute top-1 right-1 flex size-5 items-center justify-center rounded-full shadow ring-1 ring-black/5 hover:text-white"
                aria-label="Remove photo"
                title="Remove photo"
              >
                <X className="size-3" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-muted-foreground hover:text-primary flex flex-col items-center gap-1"
            >
              <ImagePlus className="size-6" />
              <span className="text-[11px] font-medium">Add photo</span>
            </button>
          )}
        </div>
        <div className="text-muted-foreground space-y-1.5 text-xs">
          <p>Uploaded as-is — original resolution and quality are kept, no cropping or compression.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} {photo ? 'Replace' : 'Upload'} photo
          </Button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function DesignNameDialog({ designName, onClose }: { designName: DesignNameDto | null; onClose: () => void }) {
  const isEdit = !!designName;
  const create = useCreateDesignName();
  const update = useUpdateDesignName(designName?.id ?? 0);
  const saving = create.isPending || update.isPending;

  const [designType, setDesignType] = useState(designName?.designType ?? '');
  const [name, setName] = useState(designName?.designName ?? '');
  const [photo, setPhoto] = useState<{ path: string; url: string } | null>(
    designName?.photoPath && designName?.photoUrl ? { path: designName.photoPath, url: designName.photoUrl } : null,
  );

  const submit = () => {
    if (!designType.trim() || !name.trim()) return toast.error('Design type and name are required');
    const input = {
      designType: designType.trim(),
      designName: name.trim(),
      photoPath: photo?.path ?? null,
      photoUrl: photo?.url ?? null,
    };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Design name updated' : 'Design name created');
        onClose();
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) update.mutate(input, opts);
    else create.mutate(input, opts);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit design name #${designName!.id}` : 'New design name'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2 [&_input]:uppercase">
            <Label>Design type *</Label>
            <Input value={designType} onChange={(e) => setDesignType(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2 [&_input]:uppercase">
            <Label>Design name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DesignPhotoField photo={photo} onChange={setPhoto} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
