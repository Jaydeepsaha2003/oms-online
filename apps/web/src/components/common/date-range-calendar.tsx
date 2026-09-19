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

/** flowbite-react Datepicker restyled to the app: round days, compact header. */
const FLOWBITE_THEME = {
  popup: {
    root: { inner: 'inline-block w-full bg-transparent p-0 pt-2 shadow-none dark:bg-transparent' },
    header: {
      selectors: {
        base: 'mb-1 flex items-center justify-between',
        button: {
          base: 'cursor-pointer rounded-lg bg-transparent px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:bg-transparent dark:text-white dark:hover:bg-white/10',
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

  // flowbite always draws 42 days and gives no "other month" flag (and its
  // filterDate can't see which month is on screen), so days before the first
  // "1" and from the next "1" on are marked here: greyed via [data-out] in
  // index.css and disabled. Re-run whenever the grid changes (month flips).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mark = () => {
      const btns = [...root.querySelectorAll<HTMLButtonElement>('.oms-days > button')];
      const first = btns.findIndex((b) => b.textContent === '1');
      const next = btns.findIndex((b, i) => i > first && b.textContent === '1');
      btns.forEach((b, i) => {
        const out = i < first || (next >= 0 && i >= next);
        if (out) {
          b.dataset.out = '';
          b.disabled = true;
        } else if (b.dataset.out !== undefined) {
          delete b.dataset.out;
          b.disabled = false;
        }
      });
    };
    mark();
    // Only childList/text: our own attribute writes don't retrigger it.
    const mo = new MutationObserver(mark);
    mo.observe(root, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  }, []);

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
        language="en-IN"
        theme={FLOWBITE_THEME}
      />
    </div>
  );
}
