import { useEffect, useRef, useState } from 'react';
import { Check, ClipboardList, Download, Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/**
 * Colored icon buttons for Excel import/export. Used across the data screens so
 * the actions look and behave consistently.
 */

export function ExportButton({
  onClick,
  label = 'Export to Excel',
  disabled,
  title,
}: {
  onClick: () => void;
  label?: string;
  /** A sentence for the hover tooltip, when the short `label` is not enough.
   *  Falls back to `label`, so existing callers are unchanged. */
  title?: string;

  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={cn(
            'size-9 border-blue-700 bg-blue-700 text-white shadow-sm',
            'hover:border-blue-800 hover:bg-blue-800 hover:text-white',
          )}
        >
          <Download className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title ?? label}</TooltipContent>
    </Tooltip>
  );
}

/** One pickable column in {@link ExportColumnsDialog}. */
export interface ExportColumn {
  id: string;
  label: string;
}

/** Read a saved column selection, tolerating absent/corrupt storage or a column
 *  set that changed since it was saved — falls back to "everything selected". */
function loadSelection(storageKey: string, columns: ExportColumn[]): string[] {
  const allIds = columns.map((c) => c.id);
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return allIds;
    const saved = JSON.parse(raw) as unknown;
    if (!Array.isArray(saved)) return allIds;
    const valid = saved.filter((id): id is string => typeof id === 'string' && allIds.includes(id));
    return valid.length ? valid : allIds;
  } catch {
    return allIds;
  }
}

/**
 * "Which columns?" prompt shown before an Excel export. Selection is remembered
 * per `storageKey` (e.g. one export button per screen), so a user who only ever
 * wants five of fourteen columns doesn't have to re-pick them every time.
 */
export function ExportColumnsDialog({
  open,
  onOpenChange,
  columns,
  storageKey,
  onExport,
  exporting,
  title = 'Choose columns to export',
  description = 'Pick the columns to include in the Excel file — your choice is remembered for next time.',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: ExportColumn[];
  /** localStorage key this dialog's selection is saved under. Give each export
   *  button on a page its own key so their choices don't collide. */
  storageKey: string;
  onExport: (columnIds: string[]) => void | Promise<void>;
  exporting?: boolean;
  title?: string;
  description?: string;
}) {
  const [selected, setSelected] = useState<string[]>(() => loadSelection(storageKey, columns));
  // Re-sync when the dialog is reopened, in case another tab/session changed the
  // saved selection meanwhile.
  useEffect(() => {
    if (open) setSelected(loadSelection(storageKey, columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storageKey]);

  const allSelected = selected.length === columns.length;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAll = () => setSelected(allSelected ? [] : columns.map((c) => c.id));

  const confirm = async () => {
    if (selected.length === 0) return;
    // Preserve the caller's canonical column order, not click order.
    const ordered = columns.filter((c) => selected.includes(c.id)).map((c) => c.id);
    try {
      localStorage.setItem(storageKey, JSON.stringify(ordered));
    } catch {
      /* private mode / quota — selection just won't persist */
    }
    await onExport(ordered);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-semibold">
            {selected.length} of {columns.length} selected
          </span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={toggleAll}>
            {allSelected ? 'Select none' : 'Select all'}
          </Button>
        </div>

        <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border p-1.5">
          {columns.map((col) => {
            const on = selected.includes(col.id);
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => toggle(col.id)}
                className="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] transition-colors',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-400',
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="truncate">{col.label}</span>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={exporting || selected.length === 0}>
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Export {selected.length ? `(${selected.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Download a blank fill-in template (distinct emerald styling vs. the data export). */
export function TemplateButton({
  onClick,
  label = 'Download fill-in template',
  disabled,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={cn(
            'size-9 border-emerald-200 bg-emerald-50 text-emerald-600',
            'hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-700',
          )}
        >
          <ClipboardList className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ImportButton({
  onFile,
  pending,
  accept = '.xlsx,.xls,.csv',
  label = 'Import from Excel',
  title,
}: {
  onFile: (file: File) => void;
  /** A sentence for the hover tooltip, when the short `label` is not enough.
   *  Falls back to `label`, so existing callers are unchanged. */
  title?: string;

  pending?: boolean;
  accept?: string;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          if (ref.current) ref.current.value = '';
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={pending}
            onClick={() => ref.current?.click()}
            aria-label={label}
            className={cn(
              'size-9 border-amber-200 bg-amber-50 text-amber-700',
              'hover:border-amber-300 hover:bg-amber-100 hover:text-amber-800',
            )}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{title ?? label}</TooltipContent>
      </Tooltip>
    </>
  );
}
