import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoTip } from '@/components/common/info-tip';
import { Button } from '@/components/ui/button';

/**
 * The panel kit behind the "special rules" screens — Customer Special Rates and
 * Agent Special Commission.
 *
 * Extracted from special-rates-page rather than copied into the second screen.
 * The two are the same idea (a narrow rule that beats a broad default, with a
 * level picker, an inline add form and a list of what is already set), and the
 * ask was explicitly for one to look like the other. Two copies of this markup
 * would look identical on the day they were written and drift by the next change.
 */
export interface Accent {
  ring: string;
  head: string;
  chip: string;
  solid: string;
  active: string;
  idle: string;
}

/** One accent per panel, so a screen with several reads as several things. */
export const ACCENTS: Record<'PRODUCT' | 'DESIGN' | 'LOGO' | 'BAG' | 'COMMISSION', Accent> = {
  PRODUCT: {
    ring: 'border-sky-200',
    head: 'from-sky-50 to-sky-100/40',
    chip: 'bg-sky-100 text-sky-700',
    solid: 'bg-sky-600 hover:bg-sky-700',
    active: 'border-sky-600 bg-sky-600 text-white',
    idle: 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700',
  },
  DESIGN: {
    ring: 'border-violet-200',
    head: 'from-violet-50 to-violet-100/40',
    chip: 'bg-violet-100 text-violet-700',
    solid: 'bg-violet-600 hover:bg-violet-700',
    active: 'border-violet-600 bg-violet-600 text-white',
    idle: 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700',
  },
  LOGO: {
    ring: 'border-rose-200',
    head: 'from-rose-50 to-rose-100/40',
    chip: 'bg-rose-100 text-rose-700',
    solid: 'bg-rose-600 hover:bg-rose-700',
    active: 'border-rose-600 bg-rose-600 text-white',
    idle: 'border-slate-200 bg-white text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700',
  },
  BAG: {
    ring: 'border-amber-200',
    head: 'from-amber-50 to-amber-100/40',
    chip: 'bg-amber-100 text-amber-700',
    solid: 'bg-amber-600 hover:bg-amber-700',
    active: 'border-amber-600 bg-amber-600 text-white',
    idle: 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700',
  },
  /** Agent commission — emerald, because it is money the agent earns, not a
   *  price the customer pays. Distinct at a glance from the rate panels. */
  COMMISSION: {
    ring: 'border-emerald-200',
    head: 'from-emerald-50 to-emerald-100/40',
    chip: 'bg-emerald-100 text-emerald-700',
    solid: 'bg-emerald-600 hover:bg-emerald-700',
    active: 'border-emerald-600 bg-emerald-600 text-white',
    idle: 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700',
  },
};

export function Panel({
  title,
  icon,
  accent,
  badge,
  info,
  className,
  children,
}: {
  title: string;
  icon: ReactNode;
  accent: Accent;
  badge: ReactNode;
  info?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('bg-card overflow-hidden rounded-xl border shadow-sm', accent.ring, className)}>
      <div className={cn('flex items-center gap-2 border-b bg-gradient-to-r px-4 py-3', accent.ring, accent.head)}>
        <span className={cn('flex size-8 items-center justify-center rounded-lg', accent.chip)}>{icon}</span>
        <h3 className="font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
        {info && <InfoTip text={info} />}
        <span className={cn('ml-auto rounded-full px-2 py-0.5 text-xs font-semibold', accent.chip)}>{badge}</span>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

/** The level picker: how narrowly this rule is aimed. */
export function LevelButtons<T extends string>({
  levels,
  value,
  onChange,
  accent,
}: {
  levels: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  accent: Accent;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {levels.map((l) => (
        <button
          key={l.value}
          type="button"
          title={l.title}
          onClick={() => onChange(l.value)}
          className={cn(
            'cursor-pointer rounded-md border px-3.5 py-2 text-base font-medium transition-colors',
            value === l.value ? accent.active : accent.idle,
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export function AddButton({
  accent,
  onClick,
  disabled,
  title,
  children,
}: {
  accent: Accent;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-base font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        accent.solid,
      )}
    >
      {children}
    </button>
  );
}

/** The trailing delete cell every one of these lists carries. */
export const deleteAction =
  <T extends { id: number }>(onDelete: (r: T) => void) =>
  (r: T) => (
    <div className="flex justify-end">
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive hover:text-destructive size-8"
        onClick={() => onDelete(r)}
        aria-label="Remove"
        title="Remove"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );

/** A labelled field in the inline add form. */
export function PanelField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="text-muted-foreground text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}
