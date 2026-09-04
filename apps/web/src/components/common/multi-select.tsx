import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * A filter dropdown that takes several values at once, with Select all / Clear.
 *
 * Built rather than reached for because the app had no such control: every
 * existing dropdown is single-value (`Combobox`, and the `Combo`/`NativeSelect`
 * wrappers over it). Extending that component to do multi-select would have
 * meant threading a second value shape through 500 lines that carefully manage
 * one — its typed text, its caret, its blur validation, its keyboard swapping —
 * so a filter that only has to tick strings is its own, much smaller thing.
 *
 * What the label says is deliberate. It reads "3 parties", not the three names:
 * a summary that grows with the selection reflows the whole filter bar on every
 * tick, and at five names it truncates and stops being readable anyway. One
 * selected value IS named, because there the name is short and it is the thing
 * you want to see without opening anything.
 */
export function MultiSelect({
  label,
  values,
  onChange,
  options,
  /** Word for one item, e.g. "party" — pluralised by adding "s" ("3 parties"
   *  needs `pluralLabel`). */
  itemLabel = 'item',
  pluralLabel,
  className,
  searchPlaceholder,
  emptyText = 'Nothing to choose from.',
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  options: string[];
  itemLabel?: string;
  pluralLabel?: string;
  className?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const picked = useMemo(() => new Set(values), [values]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const plural = pluralLabel ?? `${itemLabel}s`;
  const summary =
    values.length === 0 ? label : values.length === 1 ? values[0] : `${values.length} ${plural}`;

  /*
   * Select all applies to what is ON SCREEN, not to every option.
   *
   * With a search typed, "all" can only sensibly mean the matches — that is the
   * whole point of having searched. It ADDS to the selection rather than
   * replacing it, so searching twice and picking all of each builds a set
   * instead of throwing the first half away.
   */
  const allShownPicked = shown.length > 0 && shown.every((o) => picked.has(o));
  const toggleAllShown = () => {
    if (allShownPicked) {
      const drop = new Set(shown);
      onChange(values.filter((v) => !drop.has(v)));
    } else {
      onChange([...new Set([...values, ...shown])]);
    }
  };

  const toggle = (option: string) =>
    onChange(picked.has(option) ? values.filter((v) => v !== option) : [...values, option]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // The search is a way of finding things to tick, not part of the filter:
        // leaving it behind would make the list look half-empty on reopening.
        if (!o) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} — ${values.length} selected`}
          className={cn(
            'flex w-full cursor-pointer items-center gap-1.5 rounded-[4px] border px-2 text-left text-[12.5px] outline-none',
            'focus-visible:ring-2 focus-visible:ring-amber-400/30',
            className,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', values.length === 0 && 'text-muted-foreground')}>
            {summary}
          </span>
          {values.length > 0 && (
            // A span, not a button: this sits inside the trigger button and
            // nesting buttons is invalid HTML (and unreliable to tap on a phone).
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Clear ${label}`}
              title={`Clear ${label}`}
              className="hover:text-foreground text-muted-foreground shrink-0 rounded-[3px] p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        collisionPadding={8}
        className="w-auto p-0"
        style={{
          minWidth: 'var(--radix-popover-trigger-width)',
          maxWidth: 'min(28rem, var(--radix-popover-content-available-width))',
        }}
        onOpenAutoFocus={(e) => {
          // Focus the search rather than the first row: with a long party list,
          // typing is how anyone finds anything here.
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="border-b p-1.5">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder ?? `Search ${plural}…`}
              className="h-8 w-full rounded-[3px] border bg-transparent pr-2 pl-7 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-amber-400/30"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-b px-2 py-1">
          <button
            type="button"
            onClick={toggleAllShown}
            disabled={shown.length === 0}
            className="cursor-pointer text-[11.5px] font-bold text-indigo-700 underline-offset-2 hover:underline disabled:cursor-default disabled:opacity-40 dark:text-indigo-300"
          >
            {allShownPicked ? 'Unselect' : 'Select'} all{query.trim() ? ` ${shown.length} shown` : ''}
          </button>
          <span className="text-muted-foreground text-[11px] font-semibold tabular-nums">
            {values.length} selected
          </span>
        </div>

        <div className="max-h-64 overflow-y-auto overscroll-contain p-1">
          {shown.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-center text-[12px]">
              {query.trim() ? `Nothing matches “${query.trim()}”.` : emptyText}
            </p>
          ) : (
            shown.map((option) => {
              const on = picked.has(option);
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(option)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-[12.5px]',
                    'hover:bg-accent',
                    on && 'font-semibold',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-[3px] border',
                      on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-input',
                    )}
                  >
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
