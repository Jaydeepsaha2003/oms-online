import { useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, SlidersHorizontal } from 'lucide-react';
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
}: {
  columns: OrderableColumn[];
  hidden: string[];
  onReorder: (srcId: string, targetId: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onToggle: (id: string) => void;
  onReset: () => void;
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

      <PopoverContent align="end" className="w-72 p-2">
        <div className="flex items-center justify-between px-1.5 pb-1">
          <span className="text-sm font-semibold">Columns</span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReset}>
            Reset
          </Button>
        </div>
        <Separator />
        <div className="mt-1 max-h-[60vh] space-y-0.5 overflow-auto">
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
      </PopoverContent>
    </Popover>
  );
}
