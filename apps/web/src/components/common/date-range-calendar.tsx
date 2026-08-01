import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  'text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-30';
const SELECT =
  'h-7 cursor-pointer rounded-md border bg-transparent px-1.5 text-[12px] font-semibold outline-none transition-colors hover:bg-accent focus-visible:ring-ring/40 focus-visible:ring-2';

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
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          className={NAV_BTN}
          aria-label="Previous month"
          onClick={() => setView(new Date(viewYear, viewMonth - 1, 1))}
        >
          <ChevronLeft className="size-4" />
        </button>
        <select
          className={cn(SELECT, 'flex-1')}
          aria-label="Month"
          value={viewMonth}
          onChange={(e) => setView(new Date(viewYear, Number(e.target.value), 1))}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        <select
          className={cn(SELECT, 'w-[4.25rem]')}
          aria-label="Year"
          value={viewYear}
          onChange={(e) => setView(new Date(Number(e.target.value), viewMonth, 1))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
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
  // 42 cells from the Sunday on/before the 1st — same grid maths as DatePicker.
  const cells = useMemo(() => {
    const offset = new Date(year, month, 1).getDay();
    const first = new Date(year, month, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
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
      <div className="text-muted-foreground mb-0.5 grid grid-cols-7 text-center text-[9.5px] font-bold uppercase">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
      </div>
      {/* gap-0 so selected days form one continuous band; only the ends round off. */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d) => {
          if (d.getMonth() !== month) return <span key={d.toISOString()} className="size-7" />;
          const k = dayKey(d);
          const inRange = loK != null && hiK != null && k >= loK && k <= hiK;
          const isLo = loK === k;
          const isHi = hiK === k;
          const isEdge = isLo || isHi;
          const isToday = dayKey(today) === k;
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onPick(d)}
              onPointerEnter={() => armed && onHover(d)}
              aria-pressed={inRange}
              className={cn(
                'flex size-7 cursor-pointer items-center justify-center text-[11.5px] font-medium transition-colors',
                !inRange && 'hover:bg-accent hover:text-accent-foreground rounded-md',
                isToday && !inRange && 'text-primary font-bold ring-1 ring-primary/40 ring-inset rounded-md',
                // Middle of the band: square edges so neighbours join up.
                inRange && !isEdge && 'bg-primary/15 text-primary font-semibold',
                isEdge && 'bg-primary text-primary-foreground font-bold',
                isLo && 'rounded-l-md',
                isHi && 'rounded-r-md',
                // A one-day range is both ends at once.
                isLo && isHi && 'rounded-md',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
