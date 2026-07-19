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
  /** Fired with the raw search text on every keystroke. */
  onType?: (text: string) => void;
  /** Custom per-row renderer (e.g. tabular columns). Receives the option value; falls back to the label. */
  renderOption?: (value: string) => React.ReactNode;
  /** Optional sticky header shown above the option list (e.g. column titles). */
  listHeader?: React.ReactNode;
}

// Looks exactly like our <Input>; the field itself is the search box.
const FIELD =
  'border-input flex h-9 w-full rounded-sm border bg-transparent px-3 py-1 pr-8 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50';

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
  onType,
  renderOption,
  listHeader,
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
  const touchY = React.useRef(0); // last touch Y, for the manual scroll fallback
  // True while the pointer is held down inside the list (e.g. dragging its
  // scrollbar) — that steals focus from the field, and without this flag the
  // blur handler would close the dropdown mid-drag.
  const draggingList = React.useRef(false);

  // Reflect external value changes into the field when not actively editing.
  React.useEffect(() => {
    if (!focused.current) setText(labelFor(value));
  }, [value, labelFor]);

  const q = text.trim();
  const ql = q.toLowerCase();
  // Left-to-right (prefix) search: a value matches when the whole string OR any
  // of its words starts with what was typed — so "amra" finds "7 AMRAPALI (APS)"
  // but a mid-word substring like "rap" does not. Words split on spaces and the
  // usual separators found in item names.
  const matches = React.useMemo(() => {
    if (!dirty || ql === '') return opts;
    const prefixed = (s: string) => {
      const t = s.toLowerCase();
      return t.startsWith(ql) || t.split(/[\s(),+/-]+/).some((w) => w.startsWith(ql));
    };
    return opts.filter((o) => prefixed(o.label) || prefixed(o.value));
  }, [opts, dirty, ql]);
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

  // Inside a modal Sheet/Dialog, the scroll-lock (react-remove-scroll) swallows
  // wheel/touch on portaled popovers — the list freezes. Take over with native
  // non-passive listeners: when the body is scroll-locked, scroll the list
  // manually and stop the event before the lock's document-level handler sees
  // it. On normal (unlocked) pages the listeners do nothing — native scroll runs.
  React.useEffect(() => {
    const el = listRef.current;
    if (!open || !el) return;
    const locked = () => document.body.hasAttribute('data-scroll-locked');
    const onWheel = (e: WheelEvent) => {
      if (!locked()) return;
      e.preventDefault();
      e.stopPropagation();
      el.scrollTop += e.deltaY;
    };
    const onTouchStart = (e: TouchEvent) => {
      touchY.current = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!locked()) return;
      e.preventDefault();
      e.stopPropagation();
      const y = e.touches[0]?.clientY ?? 0;
      el.scrollTop += touchY.current - y;
      touchY.current = y;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [open]);

  // Close ONLY when a scroll container that holds the FIELD scrolls (the page
  // moving under the anchor would leave the portal'd list floating detached).
  // Scrolling the option list itself — or anything else inside the portal —
  // never matches, so browsing the dropdown with the wheel keeps it open.
  React.useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const t = e.target;
      const anchor = anchorRef.current;
      if (!anchor || !(t instanceof Node) || !t.contains(anchor)) return;
      setOpen(false);
      inputRef.current?.blur();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [open]);

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
    onType?.(next);
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
      // Blur caused by pressing inside the list (scrollbar drag, etc.): keep the
      // dropdown open and hand focus straight back to the field.
      if (draggingList.current) {
        inputRef.current?.focus();
        return;
      }
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
    draggingList.current = true;
  };

  // Release the "interacting with the list" flag as soon as the pointer lifts,
  // wherever it lifts (a scrollbar drag can end far outside the popover).
  React.useEffect(() => {
    const release = () => {
      draggingList.current = false;
    };
    window.addEventListener('mouseup', release);
    window.addEventListener('touchend', release);
    return () => {
      window.removeEventListener('mouseup', release);
      window.removeEventListener('touchend', release);
    };
  }, []);

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
        collisionPadding={8}
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
        {/* Cap the list to the space Radix actually has above/below the field
            (`--radix-popover-content-available-height`) so it never spills off the
            top/bottom of the screen, but no taller than ~5 rows (row height =
            the option's `py-1.5` padding + `text-sm` line-height; +0.5rem for
            the list's own `p-1`) — more rows always scroll into view. */}
        <div
          ref={listRef}
          className="overflow-x-hidden overflow-y-auto overscroll-contain p-1"
          style={{ maxHeight: 'min(calc((0.75rem + 1.25rem) * 5 + 0.5rem), var(--radix-popover-content-available-height, 480px))' }}
        >
          {listHeader && rows.length > 0 && (
            <div className="bg-popover text-muted-foreground sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
              <span className="size-4 shrink-0" />
              {listHeader}
            </div>
          )}
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
                {o.create ? (
                  <span className="truncate">
                    Create <span className="font-medium">“{q}”</span>
                  </span>
                ) : renderOption ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">{renderOption(o.value)}</div>
                ) : (
                  <span className="truncate">{o.label}</span>
                )}
              </div>
            ))
          )}
          {hiddenCount > 0 && (
            <div className="text-muted-foreground border-t px-3 py-1.5 text-xs">
              +{hiddenCount.toLocaleString('en-IN')} more — type to narrow…
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
