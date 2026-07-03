import { computeFollowupState, type FollowupDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';

/** Tone + label for a follow-up's urgency, from the shared state engine. */
export function urgencyMeta(f: FollowupDto) {
  const st = computeFollowupState(f);
  const d = st.daysToPromise;
  switch (st.urgency) {
    case 'OVERDUE':
      return { tone: 'rose' as const, label: d === -1 ? 'Overdue by 1 day' : `Overdue by ${Math.abs(d ?? 0)} days`, st };
    case 'DUE_TODAY':
      return { tone: 'amber' as const, label: 'Due today', st };
    case 'UPCOMING':
      return { tone: 'sky' as const, label: d === 1 ? 'Due tomorrow' : `Due in ${d} days`, st };
    case 'NO_DATE':
      return { tone: 'slate' as const, label: 'No date', st };
    default:
      return { tone: 'emerald' as const, label: 'Resolved', st };
  }
}

const TONES: Record<string, string> = {
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

export function Chip({ tone, className, children }: { tone: keyof typeof TONES | string; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset', TONES[tone] ?? TONES.slate, className)}>
      {children}
    </span>
  );
}

export function UrgencyChip({ f }: { f: FollowupDto }) {
  const m = urgencyMeta(f);
  return <Chip tone={m.tone}>{m.label}</Chip>;
}

export function promisedLabel(f: FollowupDto): string {
  return f.promisedAt ? formatDate(f.promisedAt) : 'no date';
}

/** A short "who/what" line for a follow-up. */
export function itemLine(f: FollowupDto): string {
  return f.orderCode ? `${f.orderCode}${f.itemText ? ` · ${f.itemText}` : ''}` : f.itemText || '';
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
