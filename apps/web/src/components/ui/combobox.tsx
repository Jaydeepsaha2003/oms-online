import * as React from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTouchPrimary } from '@/lib/device';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

export interface ComboboxOption {
  value: string;
  label?: string;
  /** Extra text matched by the search but never displayed — e.g. an item's pcs
   *  count and sub-category, so a size-labelled row is still found by typing its
   *  pcs, and vice-versa. */
  keywords?: string;
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
  /**
   * Open the on-screen keyboard on digits, and hand over to the letter keyboard
   * at the point the OPTIONS stop being numeric.
   *
   * For lists whose entries begin with a size and continue in words — dispatch
   * item names are "15 MIRROR (26 G) LASER", "6 JUCY", "5.5 NEW ANAND LOGO" —
   * this removes a keyboard switch from every search. How far the keypad stays
   * up is decided by the data, not by a fixed count, because no fixed count
   * works: of 730 item names, 519 turn to words after one character, 204 after
   * two, and 5 only after three ("1234 MAAP SET"). Typing "12" keeps the keypad
   * because "123…"/"1234…" exist; typing "15" gives up letters immediately
   * because nothing continues "15" with a digit.
   *
   * Omit for every other field: on a list that does not start with numbers this
   * would open a keypad that cannot type the first letter.
   */
  digitsFirst?: boolean;
}

// Looks exactly like our <Input>; the field itself is the search box.
const FIELD =
  'border-input flex h-9 w-full rounded-sm border bg-transparent px-3 py-1 pr-8 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50';

// Cap how many rows are mounted at once — huge lists (thousands) would freeze.
const RENDER_LIMIT = 100;

interface Row {
  value: string;
  label: string;
  keywords?: string;
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
  digitsFirst,
}: ComboboxProps) {
  const opts = React.useMemo<Row[]>(
    () =>
      options.map((o) =>
        typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value, keywords: o.keywords },
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
  // True only for the instant the keyboard is being swapped (see below), so the
  // field's own focus/blur handling can tell that apart from the user leaving.
  const swappingKeyboard = React.useRef(false);
  // Manual "give me letters" override (see the ABC button). Reset whenever the
  // search starts over, so the next lookup opens on digits again.
  const [forceText, setForceText] = React.useState(false);
  // Fixed for the life of the field: the ABC button is pointless where there is
  // no on-screen keyboard to switch.
  const [touchDevice] = React.useState(isTouchPrimary);
  // The Sheet/Dialog this field lives in, if any — the list is portalled into it
  // so its scroll isn't cancelled by the dialog's scroll lock (see
  // PopoverContent's `container`). null on an ordinary page: portal to the body.
  const [overlayHost, setOverlayHost] = React.useState<HTMLElement | null>(null);

  // The blur handler runs on a 120ms timer, so anything it reads from the render
  // closure is stale by the time it fires. These refs give it the CURRENT value —
  // without them, clicking a "Reset filters" button while a field was focused left
  // the old text sitting in the box after the filter state had already cleared.
  // `text` needs the same treatment for the same reason: a selection made in the
  // very act of leaving the field (Tab commits the highlighted row, below) lands
  // AFTER the blur closure was captured, so the closure still holds the half-typed
  // search text. The timer would then judge the field against what was typed
  // rather than what was picked, and report a perfectly good pick as invalid.
  const valueRef = React.useRef(value);
  const labelForRef = React.useRef(labelFor);
  const textRef = React.useRef(text);
  valueRef.current = value;
  labelForRef.current = labelFor;
  textRef.current = text;

  // Reflect external value changes into the field. "Not actively editing" means
  // either unfocused, or focused but with nothing typed yet — so a filter reset
  // lands immediately even while the field has the caret, instead of waiting for
  // blur. Mid-typing (dirty) is left alone so the sync can't eat keystrokes.
  //
  // Deliberately reads `labelFor` through the ref, NOT as a dependency: `options`
  // is an inline array literal on nearly every call site in this app, so `opts`/
  // `labelFor` get a new identity on EVERY render of the parent, whether or not
  // the actual option list changed. Depending on `labelFor` directly reran this
  // effect on every such render, and each run's `setText` — landing during a
  // focus/blur burst — could still be building on a previous render's async blur
  // timer, which was enough to tip React into "Maximum update depth exceeded".
  // `value` and `dirty` are real, meaningful dependents; `labelFor`'s IDENTITY is
  // not, so only those two gate the effect.
  React.useEffect(() => {
    if (!focused.current || !dirty) setText(labelForRef.current(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, dirty]);

  const q = text.trim();
  const ql = q.toLowerCase();
  // Multi-term prefix search: split BOTH the query and each option into words,
  // and keep an option only when EVERY typed word prefix-matches some word of its
  // searchable text (visible label + value + hidden keywords). This is what makes
  // "15 raj" find "5.5 RAJWADI" — "15" matches its pcs (a keyword) and "raj"
  // matches the product name — while staying prefix-based, not substring ("rap"
  // still won't match "AMRAPALI"). A single typed word behaves exactly as before.
  const WORD_SEP = /[\s(),+/-]+/;
  const matches = React.useMemo(() => {
    if (!dirty || ql === '') return opts;
    const terms = ql.split(WORD_SEP).filter(Boolean);

    /**
     * How well an option matches, left to right — lower is better. Matching
     * alone isn't enough to be useful: typing "10 royal special" matches both
     * "10 ROYAL SPECIAL" and "10 ROYAL DELUX SPECIAL", and the one you actually
     * typed has to come first rather than being buried under its longer
     * variants. So order the survivors by how literally they read left to right.
     */
    const rank = (label: string): number => {
      const l = label.toLowerCase();
      if (l.startsWith(ql)) return 0; // reads exactly as typed, from the start
      const words = l.split(WORD_SEP).filter(Boolean);
      // Every term prefix-matches the word in the same position — same order,
      // no words skipped ("roy spe" → "ROYAL SPECIAL").
      if (terms.every((t, i) => words[i]?.startsWith(t))) return 1;
      // Same order, but with other words in between ("10 royal special" →
      // "10 ROYAL DELUX SPECIAL").
      let w = 0;
      for (const t of terms) {
        while (w < words.length && !words[w].startsWith(t)) w++;
        if (w === words.length) return 3; // ran out — terms are out of order
        w++;
      }
      return 2;
    };

    const scored: { row: Row; score: number }[] = [];
    for (const o of opts) {
      const words = `${o.label} ${o.value} ${o.keywords ?? ''}`.toLowerCase().split(WORD_SEP).filter(Boolean);
      if (!terms.every((t) => words.some((w) => w.startsWith(t)))) continue;
      scored.push({ row: o, score: rank(o.label ?? o.value) });
    }
    // Array.prototype.sort is stable, so equally-ranked options keep the
    // caller's original ordering (usually already meaningful, e.g. A→Z).
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.row);
  }, [opts, dirty, ql]);
  const visible = matches.slice(0, RENDER_LIMIT);
  const hiddenCount = matches.length - visible.length;
  const showCreate = creatable && q !== '' && !opts.some((o) => o.value.toLowerCase() === ql);
  const rows: Row[] = showCreate ? [...visible, { value: q, label: q, create: true }] : visible;

  // Reset the highlight whenever the filter changes or the list (re)opens.
  React.useEffect(() => {
    setActive(0);
  }, [ql, open]);

  // On open, find the Sheet/Dialog panel this field sits in (if any) and portal
  // the list into it. Radix's Dialog hands react-remove-scroll its own content as
  // the one "shard" that may still scroll, and the check is
  // `shard.contains(event.target)` — a list portalled to <body> is never inside
  // it, so every wheel/touch over the list was cancelled and it would not move.
  // Rendering inside the panel puts the list back within the shard. Positioning
  // is untouched: Radix positions with `strategy: fixed`.
  React.useEffect(() => {
    if (!open) return;
    setOverlayHost(
      anchorRef.current?.closest<HTMLElement>('[data-slot="sheet-content"], [data-slot="dialog-content"], [role="dialog"]') ?? null,
    );
  }, [open]);

  // Scroll the highlighted row into view ONLY for keyboard navigation — doing it
  // on hover would fight the user's wheel scroll (rows slide under the cursor).
  React.useEffect(() => {
    if (!open || !navByKey.current) return;
    navByKey.current = false;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // Fallback for a scroll-lock we could NOT portal into (no dialog ancestor
  // found, yet the body is locked): scroll the list by hand and stop the event
  // before the lock's document-level listener sees it. Skipped when the list is
  // already inside the overlay — there the lock allows it through and native
  // scrolling runs, so taking over as well would scroll it twice per notch.
  React.useEffect(() => {
    const el = listRef.current;
    if (!open || !el || overlayHost) return;
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
  }, [open, overlayHost]);

  // Close ONLY when a scroll container that holds the FIELD scrolls (the page
  // moving under the anchor would leave the portal'd list floating detached).
  // Scrolling the option list itself — or anything else inside the portal —
  // never matches, so browsing the dropdown with the wheel keeps it open.
  React.useEffect(() => {
    if (!open) return;
    // Opening the field on a phone makes the browser scroll it up above the
    // virtual keyboard. That programmatic scroll must NOT count as "the user
    // scrolled the page away" — otherwise the dropdown slams shut the instant it
    // opens (so on mobile it looks like it never opens at all). Ignore scrolls in
    // the short settling window right after opening; genuine user scrolls later
    // still close it so the portaled list never floats detached from the field.
    const openedAt = Date.now();
    const onScroll = (e: Event) => {
      if (Date.now() - openedAt < 700) return;
      const t = e.target;
      const anchor = anchorRef.current;
      if (!anchor || !(t instanceof Node) || !t.contains(anchor)) return;
      setOpen(false);
      inputRef.current?.blur();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [open]);

  // ── Digits-first keyboard (opt-in via `digitsFirst`) ──────────────────────
  // Stay on the keypad only while BOTH hold:
  //   1. everything typed so far is part of a leading number, and
  //   2. some option continues that exact prefix with another number character.
  //
  // Rule 2 is what makes this self-limiting: the keypad is offered only while
  // the list can still be advanced with it, so the user can never be left
  // holding a keypad that cannot type the character they need. A fixed
  // threshold could not do this — at two digits it stranded the 519 names that
  // become words after one ("6 JUCY": the space and the "J" are both
  // unreachable from a numeric pad), and cut off the ones that need more.
  //
  // Derived from `text` rather than stored, so backspacing is governed by the
  // same rule as typing and needs no separate handling.
  //
  // `decimal` rather than `numeric`: 131 item names carry a decimal size
  // ("5.5 NEW ANAND LOGO"), and the plain numeric pad has no ".".
  //
  // `forceText` is the manual override behind the ABC button. Where a short
  // number is ambiguous the keypad has to stay up — at "7" both "7 DECENT" and
  // "70 …" are still live, so the app cannot know that a space is wanted next.
  // Nine prefixes do this across 285 of the 730 item names, and without a way
  // out the only recourse is picking from the list.
  const isNumberChar = (c: string) => c !== '' && /[\d.]/.test(c);
  // Extracted to a function (not just the inline `text` check) because the
  // auto-space logic in `onInputChange` below needs the SAME rule evaluated
  // against both the old and the about-to-be-typed text, to detect the exact
  // keystroke where one flips to the other.
  const computeWantsDigits = (t: string): boolean =>
    !!digitsFirst && !forceText && /^[\d.]*$/.test(t) && opts.some((o) => o.label.startsWith(t) && isNumberChar(o.label.charAt(t.length)));
  const wantsDigits = computeWantsDigits(text);
  const inputMode = !digitsFirst ? undefined : wantsDigits ? 'decimal' : 'text';

  // Android re-reads `inputMode` on the focused field and swaps the keyboard on
  // its own. iOS only looks when the field GAINS focus, so the change is
  // invisible there until the field is re-entered — bounce the focus to force
  // it. Skipped where no on-screen keyboard exists: on desktop `inputMode` does
  // nothing anyway, and blur/focus would only make the caret flicker.
  const prevWantsDigits = React.useRef(wantsDigits);
  React.useEffect(() => {
    if (!digitsFirst || prevWantsDigits.current === wantsDigits) return;
    prevWantsDigits.current = wantsDigits;

    const el = inputRef.current;
    if (!el || document.activeElement !== el) return;
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;

    // The flag stops onBlur from starting its close-and-revert timer and stops
    // onFocus from re-selecting the text — this is the same field mid-edit, not
    // the user arriving or leaving. Both handlers run synchronously inside the
    // two calls below, so clearing it straight after is safe.
    const caret = el.selectionStart;
    swappingKeyboard.current = true;
    el.blur();
    el.focus();
    swappingKeyboard.current = false;
    // Re-entering a field puts the caret at the end; typing continues where it
    // left off only if we put it back.
    if (caret != null) el.setSelectionRange(caret, caret);
  }, [wantsDigits, digitsFirst]);

  const commit = (v: string) => {
    onChange(v);
    setText(labelFor(v));
    setDirty(false);
    setOpen(false);
    setForceText(false);
  };

  // Auto-space right where the number ends. Every one of the 730 dispatch item
  // names is "<number> <words>" — the character straight after the leading
  // number run is a space, always (verified against the live list, not
  // assumed) — so the same keystroke that ends the numeric run can also
  // supply the space the user would otherwise have to type by hand, on
  // desktop and phone alike (the digits-first keypad is what makes this most
  // visible on a phone, but the underlying typing rule doesn't care which
  // keyboard produced the keystroke).
  //
  // Guarded to fire on exactly the ONE keystroke that ends the number: one
  // digit/period typed forward — not a paste, not a backspace, not a re-render
  // — that flips `computeWantsDigits` from true to false. Re-derived from the
  // OPTIONS every time (`allWantSpace`) rather than hardcoded, so a future item
  // name that breaks the "number space words" pattern is simply left alone
  // instead of getting a wrong space forced into it.
  const onInputChange = (next: string) => {
    // Cleared the field — this is a new search, so digits lead again.
    if (next === '') setForceText(false);

    let value = next;
    if (digitsFirst && next.length === text.length + 1 && next.endsWith(' ') && text.endsWith(' ')) {
      // The space was already auto-inserted below on an earlier keystroke; a
      // user who doesn't realise that and presses space anyway would otherwise
      // end up with two. Swallow their keystroke instead of adding to it.
      value = text;
    } else if (next.length === text.length + 1 && next.startsWith(text) && isNumberChar(next.charAt(text.length)) && computeWantsDigits(text) && !computeWantsDigits(next)) {
      const stillMatching = opts.filter((o) => o.label.startsWith(next));
      const allWantSpace = stillMatching.length > 0 && stillMatching.every((o) => o.label.charAt(next.length) === ' ');
      if (allWantSpace) value = next + ' ';
    }

    setText(value);
    setDirty(true);
    setOpen(true);
    onType?.(value);
    if (creatable) onChange(value); // free text is the value, live
  };

  const onFocus = () => {
    if (swappingKeyboard.current) return; // mid-edit keyboard swap, not a real focus
    focused.current = true;
    setDirty(false);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const onBlur = () => {
    if (swappingKeyboard.current) return; // mid-edit keyboard swap, not a real blur
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
        const typed = textRef.current.trim();
        // Read through the refs, not the closure: the value may have changed during
        // the 120ms wait (a Reset button clearing every filter is the common case),
        // and reverting to the stale label would put a filter back on screen that
        // is no longer applied to the data.
        const committed = labelForRef.current(valueRef.current);
        if (typed === '') {
          // Backspaced the field empty, then clicked away: this is exactly how a
          // user clears a filter — but a pick-only field's typed text was never
          // wired to `onChange` (only actually SELECTING a row is), so this used
          // to just silently revert to the old label on blur. Backspace it out,
          // look away, and the value you just deleted would reappear — clearing
          // the box did nothing. Treat it the same as picking the blank option.
          if (valueRef.current !== '') onChange('');
          setText(''); // normalizes whitespace-only input too, not just a literal ''
        } else {
          if (typed.toLowerCase() !== committed.toLowerCase() && !opts.some((o) => o.label.toLowerCase() === typed.toLowerCase())) {
            onInvalidEntry?.(typed);
          }
          setText(committed); // revert filter text to the chosen value
        }
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
    } else if (e.key === 'Tab') {
      // Tab accepts the highlighted row, exactly as Enter does — it just leaves
      // the field as well. Deliberately NO preventDefault: the whole point is
      // that focus moves on.
      //
      // Without this, "type until one row is left, then Tab" — which looks and
      // feels like picking, since that row is highlighted — committed nothing.
      // The field was left holding search text that matched no option, and on a
      // pick-only field the blur handler below reported it as an invalid entry.
      // On Item name (New Order) that meant a "Please select a correct item"
      // toast and focus pulled straight back, so Tab appeared to be dead: you
      // could never leave the field by keyboard, only by mouse.
      //
      // Only when the user has actually typed (`dirty`) — a bare Tab through an
      // untouched field must leave its existing value alone — and never on the
      // "Create …" row, whose free text is already live via onChange.
      if (open && dirty && rows[active] && !rows[active].create) commit(rows[active].value);
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
            inputMode={inputMode}
            className={cn(FIELD, wantsDigits && touchDevice && 'pr-16', className)}
          />
          {/* Escape hatch out of the keypad. Only while the keypad is actually
              up, and only where one exists — on desktop the letter keys are
              already under the user's hands. `onMouseDown` is prevented so the
              tap never blurs the field: a real blur would close the list and
              revert what has been typed. */}
          {wantsDigits && touchDevice && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setForceText(true);
                // Tapping ABC is the user saying "the number is finished, letters
                // next" — so supply the space the keypad has no key for, instead
                // of switching the keyboard and leaving them to type it.
                //
                // Safe because a letter never follows the leading number run
                // directly: all 856 distinct item names are "<number> <words>"
                // (checked against the live list, same basis as the auto-space in
                // `onInputChange`). Without this the keypad strands the common
                // case — at "8" just two names ("80 ML …") hold the pad up while
                // 113 names starting with "8 " are unreachable, and the same trap
                // exists on 7 of the 10 digits ("1" gates 451 names).
                //
                // Still derived from the OPTIONS rather than assumed, so a future
                // name that breaks the pattern (or a trailing "." mid-decimal)
                // just switches the keyboard and adds nothing. Routed through
                // `onInputChange` so the dropdown, `onType` and creatable-value
                // wiring all update exactly as they do for a typed keystroke.
                if (!text.endsWith(' ') && opts.some((o) => o.label.startsWith(`${text} `))) {
                  onInputChange(`${text} `);
                }
                inputRef.current?.focus();
              }}
              aria-label="Switch to the letter keyboard"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-7 -translate-y-1/2 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
            >
              ABC
            </button>
          )}
          <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 opacity-50" />
        </div>
      </PopoverAnchor>
      <PopoverContent
        container={overlayHost}
        align="start"
        sideOffset={4}
        collisionPadding={8}
        // `w-auto` is load-bearing: PopoverContent's base class is a fixed `w-72`,
        // which pinned every dropdown to 288px and ellipsised anything longer —
        // an invoice row like "SSS/26-27/557 · 6 RAMPATRA GLASS SET · ₹350" lost
        // the half that tells you which sale it is. Width auto lets the box size
        // to its content, between the two bounds below.
        className="w-auto p-0"
        // At least as wide as the field, at most the room actually on screen (and
        // never a full-width banner on a big monitor) — past that the row still
        // truncates, but only once there is genuinely nowhere left to grow.
        style={{
          minWidth: 'var(--radix-popover-trigger-width)',
          maxWidth: 'min(40rem, var(--radix-popover-content-available-width))',
        }}
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
                  // The "clear this filter" row is usually a bare '' option with no
                  // label (options={['', ...list]}) — display-only, fall back to the
                  // placeholder ("All customers", etc.) instead of an empty row; the
                  // field's own text/search state is untouched (still keys off '').
                  <span className={cn('truncate', !o.label && 'text-muted-foreground')}>{o.label || placeholder}</span>
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
