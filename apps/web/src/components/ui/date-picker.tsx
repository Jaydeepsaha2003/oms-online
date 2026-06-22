import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = (n: number) => String(n).padStart(2, '0');
/** Local-time YYYY-MM-DD (no timezone shift). */
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseISO(v?: string | null): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export interface DatePickerProps {
  /** Value as 'YYYY-MM-DD' (empty string when unset). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Show a clear (×) affordance + footer button. Default true. */
  clearable?: boolean;
  fromYear?: number;
  toYear?: number;
}

const TRIGGER =
  'border-input flex h-9 w-full items-center gap-2 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50';

const NAV_BTN = 'text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-md transition-colors';
const SELECT =
  'h-8 cursor-pointer rounded-md border bg-transparent px-2 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-ring/40 focus-visible:ring-2';

/** A calendar date picker styled to match the app — used everywhere a date is chosen. */
export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  disabled,
  className,
  id,
  clearable = true,
  fromYear,
  toYear,
}: DatePickerProps) {
  const selected = parseISO(value);
  const today = new Date();
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<Date>(() => selected ?? today);

  const y0 = fromYear ?? 1970;
  const y1 = toYear ?? today.getFullYear() + 10;
  const years = React.useMemo(() => {
    const out: number[] = [];
    for (let y = y1; y >= y0; y--) out.push(y);
    return out;
  }, [y0, y1]);

  const viewYear = view.getFullYear();
  const viewMonth = view.getMonth();

  // 42-cell grid starting on the Sunday on/before the 1st of the view month.
  const days = React.useMemo(() => {
    const startOffset = new Date(viewYear, viewMonth, 1).getDay();
    const start = new Date(viewYear, viewMonth, 1 - startOffset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [viewYear, viewMonth]);

  const pick = (d: Date) => {
    onChange(toISO(d));
    setOpen(false);
  };
  const clear = () => {
    onChange('');
    setOpen(false);
  };

  const display = selected
    ? selected.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setView(selected ?? new Date());
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={display || placeholder}
          className={cn(TRIGGER, !selected && 'text-muted-foreground', className)}
        >
          <CalendarDays className="size-4 shrink-0 opacity-60" />
          <span className="flex-1 truncate text-left">{display || placeholder}</span>
          {clearable && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear date"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange('');
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 rounded p-0.5 transition-colors"
            >
              <X className="size-3.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto p-3">
        {/* Month / year navigation */}
        <div className="mb-2 flex items-center gap-1">
          <button type="button" className={NAV_BTN} aria-label="Previous month" onClick={() => setView(new Date(viewYear, viewMonth - 1, 1))}>
            <ChevronLeft className="size-4" />
          </button>
          <select className={cn(SELECT, 'flex-1')} value={viewMonth} onChange={(e) => setView(new Date(viewYear, Number(e.target.value), 1))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
          <select className={cn(SELECT, 'w-[4.5rem]')} value={viewYear} onChange={(e) => setView(new Date(Number(e.target.value), viewMonth, 1))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button type="button" className={NAV_BTN} aria-label="Next month" onClick={() => setView(new Date(viewYear, viewMonth + 1, 1))}>
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Weekday header */}
        <div className="text-muted-foreground mb-1 grid grid-cols-7 text-center text-[11px] font-medium">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {days.map((d) => {
            const otherMonth = d.getMonth() !== viewMonth;
            const isSelected = selected != null && sameDay(d, selected);
            const isToday = sameDay(d, today);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => pick(d)}
                className={cn(
                  'flex size-9 items-center justify-center rounded-md text-sm transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  otherMonth && 'text-muted-foreground/40',
                  isToday && !isSelected && 'text-primary font-semibold ring-1 ring-primary/40',
                  isSelected && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground font-semibold',
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <button
            type="button"
            className="text-primary hover:bg-accent rounded-md px-2 py-1 text-xs font-medium transition-colors"
            onClick={() => pick(new Date())}
          >
            Today
          </button>
          {clearable && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-md px-2 py-1 text-xs font-medium transition-colors"
              onClick={clear}
            >
              Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
