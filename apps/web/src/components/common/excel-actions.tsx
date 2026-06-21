import { useRef } from 'react';
import { ClipboardList, Download, Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Colored icon buttons for Excel import/export. Used across the data screens so
 * the actions look and behave consistently.
 */

export function ExportButton({
  onClick,
  label = 'Export to Excel',
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
            'size-9 border-blue-200 bg-blue-50 text-blue-600',
            'hover:border-blue-300 hover:bg-blue-100 hover:text-blue-700',
          )}
        >
          <Download className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
}: {
  onFile: (file: File) => void;
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
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </>
  );
}
