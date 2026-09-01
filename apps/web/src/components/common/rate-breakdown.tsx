import { useState, type ReactNode } from 'react';
import {
  BadgePercent,
  Brush,
  type LucideIcon,
  Package,
  PackageOpen,
  Pin,
  Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

/**
 * The rate-breakdown card, shared by every screen that shows a price somebody
 * may need to take apart.
 *
 * Lifted out of the New Order form unchanged. It was the only place that could
 * answer "why is this 535?", which is a question the Debit / Credit Note form
 * needs to answer too — and a second, similar-looking card would have drifted
 * from this one within a release.
 *
 * The caller supplies the parts rather than an order Item, because the two
 * screens know a price by different routes: the order form resolves it live
 * from the masters, a note reads it off the sale it is reversing.
 */
export interface RatePart {
  amount: number;
  /** Names the rule that produced it — see {@link buildUpLabel}. */
  tag: string;
}

export interface RateBreakdownCardProps {
  productRate: number | null | undefined;
  designRate: number | null | undefined;
  /** The master rate each side started from, before its add-ons. Null when the
   *  figure has no derivation on record — the card then says so rather than
   *  inventing one. */
  productBase?: number | null;
  productParts?: RatePart[];
  designBase?: number | null;
  designParts?: RatePart[];
  /** Design name shown under the Design rate line. */
  designLabel?: string | null;
  perUnitLabel: string;
  special?: boolean;
  commissionAdded?: boolean;
  bookingCode?: string | null;
  bookingId?: number | null;
  /** An extra sentence above the sum — used where a screen knows something
   *  about the figure that the parts cannot express. */
  note?: ReactNode;
  /** What the trigger renders: the number, formatted however the host wants. */
  children: ReactNode;
}

/** Scope word for a special-rate tag. */
export const scopeWord = (s: string | null) =>
  s === 'ITEM' ? 'item' : s === 'SUBCATEGORY' ? 'sub-category' : s === 'CATEGORY' ? 'category' : '';

/** One line of the breakdown card: a coloured dot, a label, and the money. */
export function RateLine({
  icon: Icon,
  label,
  sub,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string | null;
  value: string;
  accent: 'blue' | 'violet';
}) {
  const tone =
    accent === 'blue'
      ? 'bg-blue-50 text-blue-700 ring-blue-200/70 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-900'
      : 'bg-violet-50 text-violet-700 ring-violet-200/70 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-900';
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-[6px] ring-1', tone)}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] leading-tight font-semibold">{label}</p>
        {sub && <p className="text-muted-foreground truncate text-[10.5px] leading-tight">{sub}</p>}
      </div>
      <span className="shrink-0 text-[13px] font-bold tabular-nums">{value}</span>
    </div>
  );
}

/** A row inside {@link RateBuildUp}: a label on the left, money on the right. */
function BuildUpRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={cn(
          'text-[11.5px] leading-tight',
          strong ? 'font-bold' : 'text-muted-foreground font-medium',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'shrink-0 text-[12.5px] tabular-nums',
          strong ? 'font-bold' : 'font-semibold',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * How ONE side of the rate was arrived at: the base, then every add-on on its
 * own line, then what they come to.
 *
 * Asked about the Product rate alone, a 256px card cannot answer in a run-on
 * sub-line. "Base ₹320 +₹55 (category) …" is exactly where the old one ran out
 * of width and truncated — with an ellipsis sitting where the commission, the
 * thing being asked about, should have been.
 *
 * The reconciliation guard is {@link rateSub}'s: only claim a build-up that
 * actually adds up to the figure shown. A hand-typed rate has no derivation,
 * and inventing one would be worse than saying nothing.
 */
/**
 * What to call one add-on row.
 *
 * A commission tag carries the rule that won it ("commission:Base rate",
 * "commission:JOHN · GLASS"), because "Commission" alone left the reader unable
 * to tell the agent's standing rate from a rule written for this party.
 */
function buildUpLabel(tag: string): string {
  if (!tag) return 'Special rate';
  if (!tag.startsWith('commission')) return `Special rate (${tag})`;
  const from = tag.slice('commission:'.length).trim();
  if (!from) return 'Commission';
  // "Base rate" is the agent's standing rate; anything else is a special rule.
  return /^base rate$/i.test(from)
    ? 'Commission (agent base rate)'
    : `Special commission (${from})`;
}

export function RateBuildUp({
  base,
  parts,
  total,
  accent,
}: {
  base: number | null | undefined;
  parts: { amount: number; tag: string }[];
  total: number;
  accent: 'blue' | 'violet';
}) {
  const real = parts.filter((p) => p.amount !== 0);
  const reconciles =
    base != null && Math.abs(base + real.reduce((sum, p) => sum + p.amount, 0) - total) < 0.001;
  const rule =
    accent === 'blue'
      ? 'border-blue-200 dark:border-blue-900/70'
      : 'border-violet-200 dark:border-violet-900/70';

  // No total row: whatever encloses this — the card header, or the Product /
  // Design line it sits under — already shows the figure these add up to, and
  // repeating it is the clutter this card is meant to be rid of.
  if (!reconciles) {
    // Two ways to land here — a rate typed over by hand, or no master rate on
    // record to build from. Neither is knowable from here, so claim neither.
    return (
      <p className="text-muted-foreground text-[10.5px] leading-snug">
        No breakdown available for this rate.
      </p>
    );
  }
  if (real.length === 0) {
    return (
      <p className="text-muted-foreground text-[10.5px] leading-snug">
        Nothing added — this is the master rate.
      </p>
    );
  }
  return (
    <div className={cn('space-y-1 border-l-2 pl-2', rule)}>
      <BuildUpRow label="Base rate" value={`₹${(base ?? 0).toLocaleString('en-IN')}`} />
      {real.map((part) => (
        <BuildUpRow
          key={part.tag}
          label={buildUpLabel(part.tag)}
          value={`${part.amount > 0 ? '+' : '−'}₹${Math.abs(part.amount).toLocaleString('en-IN')}`}
        />
      ))}
    </div>
  );
}

/**
 * A line's rate, with the product + design split behind a hover card.
 *
 * Hover AND click, both: hover is what a mouse user discovers, and a tap is the
 * only thing a phone can do — a hover-only card is invisible on the device where
 * this table is hardest to read. A click PINS the card open (so the figures can
 * be read without holding the mouse still, and so touch works at all); moving
 * the mouse away only closes what hover opened.
 *
 * Radix portals the card to the body, so the surrounding table's horizontal
 * scroll cannot clip it — the reason this is a popover and not an absolutely
 * positioned div inside the cell.
 */
export function RateBreakdownCard({
  productRate,
  designRate,
  productBase,
  productParts: productPartsIn,
  designBase,
  designParts: designPartsIn,
  designLabel,
  perUnitLabel,
  special,
  commissionAdded,
  bookingCode,
  bookingId,
  note,
  children,
}: RateBreakdownCardProps) {
  const productParts = productPartsIn ?? [];
  const designParts = designPartsIn ?? [];
  const prod = productRate ?? 0;
  const dsgn = designRate ?? 0;
  const total = prod + dsgn;
  const inr = (v: number) => `₹${v.toLocaleString('en-IN')}`;
  // A line with no design rate still opens — "no design rate on this line" is
  // itself the answer to "why is this 350?" — but only a line that HAS a split
  // gets the dotted underline, so the hint means something when you see it.
  const hasSplit = dsgn !== 0;
  const perUnit = perUnitLabel;

  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;

  /*
   * Unpinning clears hover as well, or the mouse still sitting on the number
   * would hold the card open and the second click would look like it did
   * nothing. Moving away and back re-opens it on hover as usual.
   *
   * Two plain setStates, NOT a setHovered inside a setPinned updater: an updater
   * must be pure, and React drops the nested update — which silently broke the
   * click entirely.
   */
  const toggle = () => {
    if (pinned) setHovered(false);
    setPinned(!pinned);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Escape and outside-click come through here; both mean "gone", so they
        // have to clear the hover flag as well or the card would spring back.
        if (!o) {
          setPinned(false);
          setHovered(false);
        }
      }}
    >
      {/*
       * Anchor, not Trigger, deliberately.
       *
       * Trigger toggles the popover on click all by itself, which fought the
       * `pinned` state: a click while hover had it open told Radix to close and
       * this component to pin, and the two cancelled out. Anchor only positions.
       */}
      <PopoverAnchor asChild>
        <span
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-label={`Rate ${total.toLocaleString('en-IN')} — show breakdown`}
          onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(false)}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          className={cn(
            'cursor-pointer rounded-[4px] px-1 outline-none transition-colors',
            'hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-400 dark:hover:bg-sky-950/40',
            open && 'bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
            hasSplit && 'underline decoration-dotted decoration-sky-400 underline-offset-[3px]',
          )}
        >
          {children}
        </span>
      </PopoverAnchor>

      <PopoverContent
        side="left"
        align="center"
        sideOffset={8}
        // Hover must not steal focus from the cell the user is typing in, and a
        // hovering card must not swallow the pointer either — otherwise moving
        // the mouse one pixel further would close it by leaving the trigger.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className={cn(
          'w-64 overflow-hidden rounded-[10px] border-0 p-0 shadow-xl',
          'ring-1 ring-slate-900/10 dark:ring-white/10',
          !pinned && 'pointer-events-none',
        )}
      >
        {/* Header: the answer first, in the brand gradient — the card is read
            top-down, and the total is what the eye came for. */}
        <div className="bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 px-3 py-2 text-white">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[10px] font-bold tracking-[0.14em] uppercase opacity-80">
              Rate breakdown
            </p>
            <p className="text-[9.5px] font-semibold opacity-80">{perUnit}</p>
          </div>
          <p className="text-[19px] leading-tight font-bold tabular-nums">{inr(total)}</p>
        </div>

        <div className="bg-card space-y-2 px-3 py-2.5">
          {/* Each side: its headline, then how it was arrived at. The build-up
              used to be crammed into the line's sub-text — "Base ₹370 +₹20
              (category) …" — where a 256px card truncated it, usually over the
              commission, which is the part people are hovering to find. */}
          <div className="space-y-1.5">
            <RateLine icon={Package} label="Product rate" value={inr(prod)} accent="blue" />
            <div className="pl-[38px]">
              <RateBuildUp base={productBase} parts={productParts} total={prod} accent="blue" />
            </div>
          </div>
          {hasSplit ? (
            <div className="space-y-1.5">
              <RateLine
                icon={Brush}
                label="Design rate"
                sub={designLabel ?? null}
                value={inr(dsgn)}
                accent="violet"
              />
              {/* Commission never appears on this side — it is folded into the
                  product rate whatever scope the winning rule was aimed at. */}
              <div className="pl-[38px]">
                <RateBuildUp base={designBase} parts={designParts} total={dsgn} accent="violet" />
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground rounded-[6px] border border-dashed px-2 py-1.5 text-[10.5px] leading-snug">
              No design rate on this line — the rate is the product rate alone.
            </p>
          )}

          {note && (
            <p className="text-muted-foreground rounded-[6px] border border-dashed px-2 py-1.5 text-[10.5px] leading-snug">
              {note}
            </p>
          )}

          {/* The sum, spelled out. The point of the card is that 350 + 15 = 365
              is checkable; showing only the parts leaves the reader to add up. */}
          {hasSplit && (
            <div className="flex items-center justify-between gap-2 border-t border-dashed pt-2">
              <p className="text-muted-foreground text-[10.5px] font-semibold">
                {inr(prod)} + {inr(dsgn)}
              </p>
              <p className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {inr(total)}
              </p>
            </div>
          )}

          {/* Why the rate is what it is, when there is a reason beyond the chart. */}
          {(special || bookingId || commissionAdded) && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {special && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <BadgePercent className="size-3" /> Special rate
                </span>
              )}
              {commissionAdded && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                  <Receipt className="size-3" /> Commission added to rate
                </span>
              )}
              {bookingId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                  <PackageOpen className="size-3" /> {bookingCode ?? 'Booking'} · rate frozen
                </span>
              )}
            </div>
          )}
        </div>

        <div className="text-muted-foreground flex items-center gap-1 border-t bg-slate-50 px-3 py-1.5 text-[9.5px] dark:bg-slate-900/50">
          <Pin className={cn('size-2.5', pinned && 'text-sky-600')} />
          {pinned ? 'Pinned — click the rate again to close' : 'Click the rate to keep this open'}
        </div>
      </PopoverContent>
    </Popover>
  );
}
