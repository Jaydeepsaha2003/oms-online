import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Small "ⓘ" that reveals a plain-English explanation of a KPI/chart on hover. */
export function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="What does this mean?"
          className="text-muted-foreground/40 hover:text-muted-foreground inline-flex shrink-0 transition-colors"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[250px] text-xs leading-relaxed font-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
