import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';

export interface ComboboxOption {
  value: string;
  label?: string;
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: (string | ComboboxOption)[];
  placeholder?: string;
  emptyText?: string;
  /** Allow free-typed values (the typed text becomes the value). */
  creatable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

// Looks exactly like our <Input>; the field itself is the search box.
const FIELD =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 pr-8 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50';

/**
 * Uniform searchable dropdown. Click/Tab into the field and type directly to
 * filter; ↑/↓ to move, Enter to pick, Esc to close. Used everywhere via the
 * Combo / NativeSelect wrappers.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  emptyText = 'No results.',
  creatable = false,
  disabled,
  className,
  id,
}: ComboboxProps) {
  const opts = React.useMemo(
    () =>
      options.map((o) =>
        typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value },
      ),
    [options],
  );
  const labelFor = React.useCallback(
    (v: string) => opts.find((o) => o.value === v)?.label ?? v,
    [opts],
  );

  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => labelFor(value));
  const [dirty, setDirty] = React.useState(false); // has the user typed since focusing?
  const focused = React.useRef(false);
  const blurTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);

  // Reflect external value changes into the field when not actively editing.
  React.useEffect(() => {
    if (!focused.current) setText(labelFor(value));
  }, [value, labelFor]);

  const q = text.trim();
  const showCreate =
    creatable && q !== '' && !opts.some((o) => o.value.toLowerCase() === q.toLowerCase());

  const commit = (v: string) => {
    onChange(v);
    setText(labelFor(v));
    setDirty(false);
    setOpen(false);
  };

  const onInputChange = (next: string) => {
    setText(next);
    setDirty(true);
    setOpen(true);
    if (creatable) onChange(next); // free text is the value, live
  };

  const onFocus = () => {
    focused.current = true;
    setDirty(false);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const onBlur = () => {
    blurTimer.current = setTimeout(() => {
      focused.current = false;
      setOpen(false);
      if (!creatable) setText(labelFor(value)); // revert filter text to the chosen value
      setDirty(false);
    }, 120);
  };
  const keepFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setOpen(false);
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) setOpen(true);
    else if (e.key === 'Enter' && open) e.preventDefault(); // pick via cmdk; don't submit the form
  };

  return (
    <CommandPrimitive shouldFilter={dirty} className="relative">
      <Popover open={open && !disabled} onOpenChange={(o) => !o && setOpen(false)}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} className="relative">
            <CommandPrimitive.Input
              ref={inputRef}
              id={id}
              value={text}
              onValueChange={onInputChange}
              onFocus={onFocus}
              onBlur={onBlur}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              role="combobox"
              aria-expanded={open}
              autoComplete="off"
              className={cn(FIELD, className)}
            />
            <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 opacity-50" />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="p-0"
          style={{ width: 'var(--radix-popover-trigger-width)' }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          onMouseDown={keepFocus}
        >
          <CommandList>
            {!showCreate && <CommandEmpty>{emptyText}</CommandEmpty>}
            <CommandGroup>
              {opts.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onMouseDown={(e) => e.preventDefault()}
                  onSelect={() => commit(o.value)}
                >
                  <Check className={cn('size-4', value === o.value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
              {showCreate && (
                <CommandItem value={q} onMouseDown={(e) => e.preventDefault()} onSelect={() => commit(q)}>
                  <Plus className="size-4" />
                  <span className="truncate">
                    Create <span className="font-medium">“{q}”</span>
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </PopoverContent>
      </Popover>
    </CommandPrimitive>
  );
}
