import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

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

/** Midnight-normalised day number, safe to compare with < > =. */
const dayKey = (d: Date) => d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate();

const NAV_BTN =
  'text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-30';
// Borderless, reads as "September ▾ 2026 ▾" (Material style) but stays a native
// select, so month/year jumps keep working with keyboard and on phones.
const SELECT =
  'h-7 cursor-pointer appearance-none rounded-md bg-transparent py-0 pr-5 pl-1.5 text-[13px] font-semibold text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-ring/40 focus-visible:ring-2';

function Picker({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <span className="relative inline-flex items-center">
      <select className={cn(SELECT, className)} {...props} />
      <ChevronDown className="text-muted-foreground pointer-events-none absolute right-1 size-3.5" />
    </span>
  );
}

/**
 * A two-month range calendar with hover preview — no external date library.
 *
 * Picking works the way every range picker does: the first click sets the start
 * and arms the range, the second click closes it (clicking earlier than the start
 * just re-anchors instead of producing a backwards range). While armed, hovering
 * paints the range you'd get, so you can see the span before committing.
 */
export function DateRangeCalendar({
  from,
  to,
  onChange,
  months = 1,
  className,
}: {
  /** ISO yyyy-mm-dd, or '' when unset. */
  from: string;
  to: string;
  /** Called with both ends; `to` is '' while only the start has been picked. */
  onChange: (from: string, to: string) => void;
  /** How many months to show side by side. One keeps the popover compact. */
  months?: number;
  className?: string;
}) {
  const start = parseISO(from);
  const end = parseISO(to);
  const today = new Date();

  /** Set once the first click lands, cleared when the range completes. */
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);
  /** Left-hand month; the right-hand one is always the month after. */
  const [view, setView] = useState<Date>(() => start ?? today);

  // When the range is set from outside (a quick-range preset), jump the calendar to
  // it — otherwise picking "Last Year" leaves you staring at the current month.
  // Adjusting state during render rather than in an effect avoids a second paint;
  // a range being dragged out (anchor armed) is left alone.
  const [lastFrom, setLastFrom] = useState(from);
  if (from !== lastFrom) {
    setLastFrom(from);
    const d = parseISO(from);
    if (d && !anchor) setView(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  const viewYear = view.getFullYear();
  const viewMonth = view.getMonth();
  const years = useMemo(() => {
    const y1 = today.getFullYear() + 5;
    const out: number[] = [];
    for (let y = y1; y >= 1970; y--) out.push(y);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The span to paint: the committed range, or the live one being dragged out.
  const [lo, hi] = (() => {
    if (anchor) {
      const other = hover ?? anchor;
      return dayKey(anchor) <= dayKey(other) ? [anchor, other] : [other, anchor];
    }
    if (start && end) return [start, end];
    if (start) return [start, start];
    return [null, null];
  })();

  const pick = (d: Date) => {
    if (!anchor) {
      setAnchor(d);
      setHover(d);
      onChange(toISO(d), '');
      return;
    }
    // A second click before the anchor re-anchors rather than inverting the range.
    if (dayKey(d) < dayKey(anchor)) {
      setAnchor(d);
      onChange(toISO(d), '');
      return;
    }
    setAnchor(null);
    setHover(null);
    onChange(toISO(anchor), toISO(d));
  };

  return (
    <div className={cn('select-none', className)} onPointerLeave={() => !anchor && setHover(null)}>
      {/* Nav — one row driving both months */}
      <div className="mb-1.5 flex items-center">
        <Picker
          aria-label="Month"
          value={viewMonth}
          onChange={(e) => setView(new Date(viewYear, Number(e.target.value), 1))}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </Picker>
        <Picker
          aria-label="Year"
          value={viewYear}
          onChange={(e) => setView(new Date(Number(e.target.value), viewMonth, 1))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Picker>
        <button
          type="button"
          className={cn(NAV_BTN, 'ml-auto')}
          aria-label="Previous month"
          onClick={() => setView(new Date(viewYear, viewMonth - 1, 1))}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          className={NAV_BTN}
          aria-label="Next month"
          onClick={() => setView(new Date(viewYear, viewMonth + 1, 1))}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="flex gap-3">
        {Array.from({ length: Math.max(1, months) }, (_, i) => {
          const abs = viewMonth + i;
          return (
            <Month
              key={i}
              year={viewYear + Math.floor(abs / 12)}
              month={((abs % 12) + 12) % 12}
              lo={lo}
              hi={hi}
              today={today}
              armed={!!anchor}
              onPick={pick}
              onHover={setHover}
              showLabel={months > 1}
            />
          );
        })}
      </div>

      {anchor && (
        <p className="text-muted-foreground mt-1.5 text-[10.5px] font-medium">
          Pick the end date, or a day before {pad(anchor.getDate())}/{pad(anchor.getMonth() + 1)} to restart.
        </p>
      )}
    </div>
  );
}

/** One month grid. Days outside the month render as gaps so the range band
 *  never bleeds past the month edges. */
function Month({
  year,
  month,
  lo,
  hi,
  today,
  armed,
  onPick,
  onHover,
  showLabel,
  className,
}: {
  year: number;
  month: number;
  lo: Date | null;
  hi: Date | null;
  today: Date;
  armed: boolean;
  onPick: (d: Date) => void;
  onHover: (d: Date | null) => void;
  /** Only needed with several months on screen — one month is already named in the nav. */
  showLabel?: boolean;
  className?: string;
}) {
  // From the Sunday on/before the 1st, only as many weeks as the month needs
  // (4–6) — a fixed 42 cells leaves an empty last row most months.
  const cells = useMemo(() => {
    const offset = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const first = new Date(year, month, 1 - offset);
    const n = Math.ceil((offset + days) / 7) * 7;
    return Array.from({ length: n }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  }, [year, month]);

  const loK = lo ? dayKey(lo) : null;
  const hiK = hi ? dayKey(hi) : null;

  return (
    <div className={className}>
      {showLabel && (
        <p className="mb-1 text-center text-[11.5px] font-bold">
          {MONTHS[month]} {year}
        </p>
      )}
      <div className="text-muted-foreground mb-1 grid grid-cols-7 text-center text-[11px] font-semibold">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-0.5">
            {w[0]}
          </div>
        ))}
      </div>
      {/* Material-style: each day is a circle. The range is a band painted on the
          CELL behind the circles — full width in the middle, half width at the two
          ends — so the circles sit on one continuous strip. */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d) => {
          if (d.getMonth() !== month) return <span key={d.toISOString()} className="h-8" />;
          const k = dayKey(d);
          const inRange = loK != null && hiK != null && k >= loK && k <= hiK;
          const isLo = loK === k;
          const isHi = hiK === k;
          const isEdge = isLo || isHi;
          const isToday = dayKey(today) === k;
          const band = inRange && !(isLo && isHi);
          return (
            <div
              key={d.toISOString()}
              className={cn(
                'flex h-8 items-center justify-center',
                band && 'bg-primary/12',
                band && isLo && 'bg-transparent bg-[linear-gradient(to_right,transparent_50%,color-mix(in_oklch,var(--primary)_12%,transparent)_50%)]',
                band && isHi && 'bg-transparent bg-[linear-gradient(to_left,transparent_50%,color-mix(in_oklch,var(--primary)_12%,transparent)_50%)]',
              )}
            >
              <button
                type="button"
                onClick={() => onPick(d)}
                onPointerEnter={() => armed && onHover(d)}
                aria-pressed={inRange}
                className={cn(
                  'flex size-8 cursor-pointer items-center justify-center rounded-full text-[12px] font-medium tabular-nums transition-all duration-150',
                  !inRange && 'hover:bg-accent hover:text-accent-foreground',
                  isToday && !isEdge && 'ring-foreground/60 font-semibold ring-1 ring-inset',
                  inRange && !isEdge && 'text-primary font-semibold',
                  isEdge && 'bg-primary text-primary-foreground scale-105 font-bold shadow-md shadow-primary/30',
                )}
              >
                {d.getDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
