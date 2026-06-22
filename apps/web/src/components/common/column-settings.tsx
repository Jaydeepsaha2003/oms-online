import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { OrderableColumn } from '@/hooks/use-column-order';

/**
 * Toolbar control to rearrange / show-hide table columns. Reorder by dragging the
 * grip or with the up/down chevrons; toggle visibility with the eye.
 */
export function ColumnSettings({
  columns,
  hidden,
  onReorder,
  onMove,
  onToggle,
  onReset,
  dateFormat,
}: {
  columns: OrderableColumn[];
  hidden: string[];
  onReorder: (srcId: string, targetId: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onToggle: (id: string) => void;
  onReset: () => void;
  /** Optional date-format picker shown below the columns. */
  dateFormat?: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void };
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="size-9" aria-label="Arrange columns">
              <SlidersHorizontal className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Arrange columns</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-1.5 pb-1">
          <span className="text-sm font-semibold">Columns</span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReset}>
            Reset
          </Button>
        </div>
        <Separator />
        <div className="mt-1 space-y-0.5">
          {columns.map((col, i) => {
            const isHidden = hidden.includes(col.id);
            return (
              <div
                key={col.id}
                draggable
                onDragStart={() => setDragId(col.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (col.id !== overId) setOverId(col.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) onReorder(dragId, col.id);
                  setDragId(null);
                  setOverId(null);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-md py-1 pl-1 pr-0.5 transition-colors',
                  overId === col.id && dragId && dragId !== col.id && 'bg-accent',
                  dragId === col.id && 'opacity-50',
                )}
              >
                <GripVertical className="text-muted-foreground size-4 shrink-0 cursor-grab" />
                <span className={cn('flex-1 truncate text-sm', isHidden && 'text-muted-foreground/60')}>
                  {col.label}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={i === 0}
                  onClick={() => onMove(col.id, -1)}
                  aria-label={`Move ${col.label} up`}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={i === columns.length - 1}
                  onClick={() => onMove(col.id, 1)}
                  aria-label={`Move ${col.label} down`}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => onToggle(col.id)}
                  aria-label={isHidden ? `Show ${col.label}` : `Hide ${col.label}`}
                >
                  {isHidden ? (
                    <EyeOff className="text-muted-foreground size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        {dateFormat && (
          <>
            <Separator className="my-2" />
            <div className="px-1.5 pb-1 text-sm font-semibold">Date format</div>
            <div className="space-y-0.5">
              {dateFormat.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => dateFormat.onChange(o.id)}
                  className={cn(
                    'hover:bg-accent flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                    dateFormat.value === o.id && 'bg-accent font-medium',
                  )}
                >
                  <span className="tabular-nums">{o.label}</span>
                  {dateFormat.value === o.id && <Check className="size-3.5" />}
                </button>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
