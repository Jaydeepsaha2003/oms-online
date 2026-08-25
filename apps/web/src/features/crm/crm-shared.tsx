import { AlarmClock, Check } from 'lucide-react';
import { computeFollowupState, type FollowupDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { Button } from '@/components/ui/button';

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

export function Chip({ tone, className, title, children }: { tone: keyof typeof TONES | string; className?: string; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset', TONES[tone] ?? TONES.slate, className)}>
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
  const line = f.orderCode ? `${f.orderCode}${f.itemText ? ` · ${f.itemText}` : ''}` : f.itemText || '';
  // Suppressed when the title already says it. PAYMENT follow-ups are created
  // with an auto-generated title of "Collect <itemText>", so every caller that
  // renders `title · itemLine` printed the same amount and invoice number twice
  // in one sentence — e.g. "Collect ₹39,650 for SSS/26-27/16 · ₹39,650 for
  // SSS/26-27/16" on the reminder banner. Doing it here fixes the banner and the
  // board list together, instead of patching each render site.
  return line && f.title.includes(line) ? '' : line;
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}


/**
 * Group follow-ups by party, keeping the order they arrived in.
 *
 * The board hands back one row per follow-up, so a party that owes on three
 * invoices appeared three times in a row with its name repeated — the name
 * dominated the panel and the thing that actually differs between the rows (the
 * amount, the invoice) was the small grey text underneath.
 *
 * Keyed on `customerId` where there is one: two saved parties can share a
 * display name, and merging them under one heading would claim a debt belongs to
 * someone it does not. Free-typed names (customerId null) fall back to the name
 * itself, which is all there is to go on.
 *
 * Insertion order is preserved rather than sorted, because the caller has
 * already ordered the list by urgency — re-sorting here would quietly move the
 * most pressing party down the panel.
 */
export function groupByParty(items: FollowupDto[]): { key: string; partyName: string; items: FollowupDto[] }[] {
  const groups = new Map<string, { key: string; partyName: string; items: FollowupDto[] }>();
  for (const f of items) {
    const key = f.customerId != null ? `id:${f.customerId}` : `name:${f.partyName.trim().toUpperCase()}`;
    const g = groups.get(key) ?? { key, partyName: f.partyName, items: [] };
    g.items.push(f);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * The notification list, grouped under one heading per party.
 *
 * Shared by the dashboard rail and the bell popover so the two cannot drift —
 * they had two copies of the same markup, and the party name was repeated in
 * both.
 *
 * Urgency stays on the ROW, not the heading: two follow-ups for one party can be
 * overdue by different amounts, and hoisting the worst one to the heading would
 * label the calmer row with the harsher chip. The heading carries only what is
 * genuinely shared — the party, and how many of them there are.
 */
export function FollowupPartyList({
  items,
  canUpdate,
  onSnooze,
  onResolve,
  snoozing,
  resolving,
  padded = false,
}: {
  items: FollowupDto[];
  canUpdate: boolean;
  onSnooze: (id: number) => void;
  onResolve: (id: number) => void;
  snoozing: boolean;
  resolving: boolean;
  /** Bell popover pads its own rows; the dashboard rail sits inside card padding. */
  padded?: boolean;
}) {
  const groups = groupByParty(items);
  return (
    <div className="divide-y">
      {groups.map((g) => (
        <div key={g.key} className={cn('py-2', padded && 'px-3 py-2.5')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 font-medium break-words">{g.partyName}</span>
            {/* Only when it earns its place — a "1" beside every single-item
                party is noise on the one panel that must stay scannable. */}
            {g.items.length > 1 && <Chip tone="slate">{g.items.length}</Chip>}
          </div>

          <div className={cn('mt-1 space-y-1.5', g.items.length > 1 && 'border-l pl-2.5')}>
            {g.items.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {f.priority === 'URGENT' && <Chip tone="rose">URGENT</Chip>}
                    <UrgencyChip f={f} />
                    {f.stage && <Chip tone="slate">{f.stage}</Chip>}
                  </div>
                  <div className="text-muted-foreground mt-0.5 truncate text-xs">
                    {f.title}
                    {itemLine(f) ? ` · ${itemLine(f)}` : ''}
                    {f.promisedAt ? ` · promised ${formatDate(f.promisedAt)}` : ''}
                  </div>
                </div>
                {canUpdate && (
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-amber-700"
                      disabled={snoozing}
                      onClick={() => onSnooze(f.id)}
                    >
                      <AlarmClock className="size-3" /> Snooze
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-emerald-700"
                      disabled={resolving}
                      onClick={() => onResolve(f.id)}
                    >
                      <Check className="size-3" /> Done
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
