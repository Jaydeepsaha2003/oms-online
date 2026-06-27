import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A small "i" icon that reveals an explanation on hover/focus. Use next to a
 * heading or control to describe what it does.
 */
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label="More info"
          className={cn('text-muted-foreground/70 hover:text-foreground inline-flex shrink-0 cursor-help transition-colors', className)}
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-balance">{text}</TooltipContent>
    </Tooltip>
  );
}
