import type { TallyImportParty } from '@oms/shared';

/** A fuzzy suggestion is not a saved link until the user explicitly picks it. */
export function initialTallyPartyCustomerId(party: Pick<TallyImportParty, 'match'>): number | null {
  if (!party.match || party.match.how === 'LOOKS_LIKE') return null;
  return party.match.customerId;
}

export type TallyPartyReviewBucket = 'matched' | 'skipped' | 'missing';

/** Keep previously skipped names out of the first-time "Not in OMS" queue. */
export function tallyPartyReviewBucket(input: { customerId: number | null; previouslySkipped: boolean }): TallyPartyReviewBucket {
  if (input.customerId != null) return 'matched';
  return input.previouslySkipped ? 'skipped' : 'missing';
}
