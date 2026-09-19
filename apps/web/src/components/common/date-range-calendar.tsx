import { useEffect, useRef, useState } from 'react';
import { Datepicker } from 'flowbite-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';

const pad = (n: number) => String(n).padStart(2, '0');
/** Local-time YYYY-MM-DD (no timezone shift) — matches the app's DatePicker. */
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseISO(v?: string | null): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const LANG = 'en-IN';

/** flowbite-react Datepicker restyled to the app: round days, compact header. */
const FLOWBITE_THEME = {
  popup: {
    root: { inner: 'inline-block w-full bg-transparent p-0 pt-2 shadow-none dark:bg-transparent' },
    header: {
      selectors: {
        base: 'mb-1 flex items-center justify-between',
        button: {
          base: 'cursor-pointer rounded-lg bg-transparent px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:bg-transparent dark:text-white dark:hover:bg-white/10',
          view: 'oms-title',
        },
      },
    },
  },
  views: {
    days: {
      items: {
        base: 'oms-days grid w-full grid-cols-7 gap-y-0.5',
        item: {
          base: 'mx-auto block size-8 cursor-pointer rounded-full border-0 text-center text-[12.5px] font-medium leading-8 text-slate-800 hover:bg-slate-100 dark:text-white dark:hover:bg-white/10',
          selected: 'bg-blue-600 font-bold text-white shadow-md shadow-blue-600/30 hover:bg-blue-600',
        },
      },
    },
    months: { items: { base: 'grid w-full grid-cols-4' } },
    years: { items: { base: 'grid w-full grid-cols-4' } },
    decades: { items: { base: 'grid w-full grid-cols-4' } },
  },
};

/**
 * From → To range picker on flowbite-react's (single-date) Datepicker.
 *
 * A From / To switch picks which end the calendar edits. Picking From hops to
 * To; a To before From (or a From after To) pulls the other end along, so the
 * range can never be backwards. Either end may be '' (no bound) — the pages
 * treat that as "no date filter".
 */
export function DateRangeCalendar({
  from,
  to,
  onChange,
  className,
}: {
  /** ISO yyyy-mm-dd, or '' when unset. */
  from: string;
  to: string;
  /** Called with both ends ('' = unbounded). */
  onChange: (from: string, to: string) => void;
  /** Accepted for compatibility; the flowbite picker always shows one month. */
  months?: number;
  className?: string;
}) {
  const [end, setEnd] = useState<'from' | 'to'>('from');

  // flowbite only knows ONE selected date and has no "other month" flag, so the
  // day grid is annotated here (styled in index.css):
  //  - data-out:   previous/next-month days (before the first "1", from the next
  //                "1" on) — grey and disabled;
  //  - data-range: days strictly between From and To — light blue;
  //  - data-edge:  the From / To days themselves — solid blue (flowbite only
  //                paints the end being edited).
  // The shown month comes from flowbite's title ("September 2026", same en-IN
  // format). Re-runs when the grid changes (month flips) and when from/to change.
  const rootRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef({ from, to });
  rangeRef.current = { from, to };
  const markRef = useRef<() => void>(() => {});
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const titleFmt = new Intl.DateTimeFormat(LANG, { month: 'long', year: 'numeric' });
    const setFlag = (b: HTMLElement, key: 'out' | 'range' | 'edge', on: boolean) => {
      if (on && b.dataset[key] === undefined) b.dataset[key] = '';
      else if (!on && b.dataset[key] !== undefined) delete b.dataset[key];
    };
    const mark = () => {
      const btns = [...root.querySelectorAll<HTMLButtonElement>('.oms-days > button')];
      if (!btns.length) return;
      const first = btns.findIndex((b) => b.textContent === '1');
      const next = btns.findIndex((b, i) => i > first && b.textContent === '1');

      // Which month is on screen, e.g. "September 2026" → 2026-09.
      const title = root.querySelector('.oms-title')?.textContent ?? '';
      const year = Number(/\d{4}/.exec(title)?.[0]);
      const month = year ? Array.from({ length: 12 }, (_, m) => m).find((m) => titleFmt.format(new Date(year, m, 1)) === title) : undefined;
      const { from: lo, to: hi } = rangeRef.current;

      btns.forEach((b, i) => {
        const out = i < first || (next >= 0 && i >= next);
        setFlag(b, 'out', out);
        if (out !== b.disabled) b.disabled = out;
        const iso = !out && month !== undefined ? toISO(new Date(year, month, Number(b.textContent))) : '';
        setFlag(b, 'edge', !!iso && (iso === lo || iso === hi));
        setFlag(b, 'range', !!iso && !!lo && !!hi && iso > lo && iso < hi);
      });
    };
    markRef.current = mark;
    mark();
    // Only childList/text: our own attribute writes don't retrigger it.
    const mo = new MutationObserver(mark);
    mo.observe(root, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  }, []);
  useEffect(() => markRef.current(), [from, to, end]);

  const pick = (d: Date | null) => {
    if (!d) return;
    const v = toISO(d);
    if (end === 'from') {
      onChange(v, !to || v > to ? v : to);
      setEnd('to');
    } else {
      onChange(from && v < from ? v : from, v);
    }
  };

  return (
    <div ref={rootRef} className={cn('min-w-[14.5rem] select-none', className)}>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-white/5">
        {(['from', 'to'] as const).map((k) => {
          const v = k === 'from' ? from : to;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setEnd(k)}
              aria-pressed={end === k}
              className={cn(
                'flex cursor-pointer items-baseline justify-center gap-1.5 rounded-md py-1 text-[11.5px] transition-all',
                end === k
                  ? 'bg-white font-semibold text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="text-[10px] font-bold tracking-wider uppercase">{k}</span>
              <span className="tabular-nums">{v ? formatDate(v) : '—'}</span>
            </button>
          );
        })}
      </div>
      <Datepicker
        key={end}
        inline
        value={parseISO(end === 'from' ? from : to)}
        onChange={pick}
        showClearButton={false}
        showTodayButton={false}
        language={LANG}
        theme={FLOWBITE_THEME}
      />
    </div>
  );
}
