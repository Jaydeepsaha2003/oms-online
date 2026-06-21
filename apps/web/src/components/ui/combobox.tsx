import * as React from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

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
  /** Pick-only fields: fired on blur when the typed text matches no option. */
  onInvalidEntry?: (typed: string) => void;
}

// Looks exactly like our <Input>; the field itself is the search box.
const FIELD =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 pr-8 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50';

// Cap how many rows are mounted at once — huge lists (thousands) would freeze.
const RENDER_LIMIT = 100;

interface Row {
  value: string;
  label: string;
  create?: boolean;
}

/**
 * Uniform searchable dropdown. Click or Tab into the field; type to filter;
 * ↑/↓ to move the highlight, Enter to pick, Esc to close. Pick-only by default;
 * pass `creatable` to allow free-typed values. Used everywhere via the
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
  onInvalidEntry,
}: ComboboxProps) {
  const opts = React.useMemo<Row[]>(
    () =>
      options.map((o) =>
        typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value },
      ),
    [options],
  );
  const labelFor = React.useCallback((v: string) => opts.find((o) => o.value === v)?.label ?? v, [opts]);

  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => labelFor(value));
  const [dirty, setDirty] = React.useState(false); // has the user typed since focusing?
  const [active, setActive] = React.useState(0); // highlighted row index
  const focused = React.useRef(false);
  const blurTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const navByKey = React.useRef(false); // last highlight change came from the keyboard

  // Reflect external value changes into the field when not actively editing.
  React.useEffect(() => {
    if (!focused.current) setText(labelFor(value));
  }, [value, labelFor]);

  const q = text.trim();
  const ql = q.toLowerCase();
  const matches = React.useMemo(
    () =>
      !dirty || ql === ''
        ? opts
        : opts.filter((o) => o.label.toLowerCase().includes(ql) || o.value.toLowerCase().includes(ql)),
    [opts, dirty, ql],
  );
  const visible = matches.slice(0, RENDER_LIMIT);
  const hiddenCount = matches.length - visible.length;
  const showCreate = creatable && q !== '' && !opts.some((o) => o.value.toLowerCase() === ql);
  const rows: Row[] = showCreate ? [...visible, { value: q, label: q, create: true }] : visible;

  // Reset the highlight whenever the filter changes or the list (re)opens.
  React.useEffect(() => {
    setActive(0);
  }, [ql, open]);

  // Scroll the highlighted row into view ONLY for keyboard navigation — doing it
  // on hover would fight the user's wheel scroll (rows slide under the cursor).
  React.useEffect(() => {
    if (!open || !navByKey.current) return;
    navByKey.current = false;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

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
      if (!creatable) {
        const typed = text.trim();
        const committed = labelFor(value);
        if (
          typed &&
          typed.toLowerCase() !== committed.toLowerCase() &&
          !opts.some((o) => o.label.toLowerCase() === typed.toLowerCase())
        ) {
          onInvalidEntry?.(typed);
        }
        setText(committed); // revert filter text to the chosen value
      }
      setDirty(false);
    }, 120);
  };
  const keepFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navByKey.current = true;
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navByKey.current = true;
      if (!open) setOpen(true);
      else setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && rows[active]) {
        e.preventDefault();
        commit(rows[active].value);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      navByKey.current = true;
      setActive(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      navByKey.current = true;
      setActive(rows.length - 1);
    }
  };

  return (
    <Popover open={open && !disabled} onOpenChange={(o) => !o && setOpen(false)}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative">
          <input
            ref={inputRef}
            id={id}
            value={text}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            onClick={() => setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
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
        <div ref={listRef} className="max-h-64 overflow-x-hidden overflow-y-auto overscroll-contain p-1">
          {rows.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-sm">{emptyText}</div>
          ) : (
            rows.map((o, i) => (
              <div
                key={o.create ? '__create' : o.value}
                data-idx={i}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => commit(o.value)}
                className={cn(
                  'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none',
                  i === active && 'bg-accent text-accent-foreground',
                )}
              >
                {o.create ? (
                  <Plus className="size-4 shrink-0" />
                ) : (
                  <Check className={cn('size-4 shrink-0', value === o.value ? 'opacity-100' : 'opacity-0')} />
                )}
                <span className="truncate">
                  {o.create ? (
                    <>
                      Create <span className="font-medium">“{q}”</span>
                    </>
                  ) : (
                    o.label
                  )}
                </span>
              </div>
            ))
          )}
          {hiddenCount > 0 && (
            <div className="text-muted-foreground border-t px-3 py-1.5 text-xs">
              +{hiddenCount.toLocaleString()} more — type to narrow…
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
