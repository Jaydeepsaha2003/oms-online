import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The three master rates a challan line is priced from.
 *
 * `undefined` is allowed on purpose even though the API types say otherwise —
 * see {@link missingRatesFor}. A payload that predates these fields is exactly
 * the case that must not be mistaken for "unconfigured".
 */
interface RateBearing {
  gstRate?: number | null;
  freightRate?: number | null;
  packingRate?: number | null;
  pCategory?: string | null;
}

/**
 * Which of the three master rates this line has NO configured row for.
 *
 * Only an explicit `null` counts: that is the server saying "the rate master
 * holds nothing for this category". A deliberate `0` is configured and must
 * never flag.
 *
 * `undefined` — the field absent from the payload — is NOT the same thing and
 * must never flag either. It means the server didn't answer the question at
 * all, which is what an API build older than this feature returns. Treating
 * that as "unconfigured" (a plain `== null`) flagged every rate on every row,
 * for every party, which is precisely the false alarm that looked like a
 * caching bug: the badges were unanimous because the data was absent, not
 * because the rates were. Silence beats crying wolf on the whole list.
 */
export function missingRatesFor(r: RateBearing): string[] {
  const miss: string[] = [];
  if (r.gstRate === null) miss.push('GST');
  if (r.freightRate === null) miss.push('Freight');
  if (r.packingRate === null) miss.push('Packing');
  return miss;
}

/**
 * Persistent marker for a line whose category has no rates configured.
 *
 * Replaces a toast that named only the CATEGORY and then vanished, leaving the
 * operator to work out which row it meant. Shown on the challan form and on
 * Pending Challan, so the problem is visible before any time is spent on it.
 */
export function MissingRateBadge({
  missing,
  pCategory,
  className,
  showCategory = false,
}: {
  missing: string[];
  pCategory?: string | null;
  className?: string;
  showCategory?: boolean;
}) {
  if (!missing.length) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded bg-amber-200/80 px-1.5 py-px align-middle text-[10px] font-bold whitespace-nowrap text-amber-900 dark:bg-amber-400/20 dark:text-amber-200',
        className,
      )}
      title={`No rate configured for ${pCategory || 'this category'} — add it under Customer GST Rates / Transport Rates`}
    >
      <AlertTriangle className="size-3" /> No {missing.join(' · ')} rate
      {showCategory && pCategory ? ` · ${pCategory}` : ''}
    </span>
  );
}
