import type { CommissionBasis } from './agent-commission';
import type { SpecialCommissionScope } from './agent-special-commission';

/**
 * Agent Rate List
 * -----------------------------------------------------------------------------
 * What a customer pays for each product, beside what the agent earns on it.
 *
 * The customer rate list answers "what do we charge?"; the commission screens
 * answer "what does this agent earn per kg on GLASS?". Neither answers the
 * question an agent actually asks — "on this item, at this party, what is the
 * price and what is my cut?" — because the two live on different screens and the
 * commission one is stated per CATEGORY, not per product.
 *
 * A note on the arithmetic, because the naming invites a wrong sum: a special
 * commission REPLACES the base commission, it is not added to it. So the sheet
 * carries `baseCommission` and `specialCommission` as separate columns and an
 * `effectiveCommission` that is one or the other — never their total. Adding
 * them would overstate every line that has a special.
 */

/** Where a line's commission came from. */
export type CommissionSource = 'BASE' | 'SPECIAL' | 'NONE';

export interface AgentRateListRow {
  category: string;
  subCategory: string;
  product: string;
  size: number | null;
  pcs: number | null;
  /** What the customer pays — the party's effective rate when a party is named,
   *  otherwise the plain chart rate. */
  productRate: number;
  /** The agent's category-level commission, per unit. Null when the agent has no
   *  base rate for that category, which is how "no commission here" is said. */
  baseCommission: number | null;
  /** The winning special commission, when one matched. Null otherwise. */
  specialCommission: number | null;
  /** What the agent actually earns per unit on this line: the special if one
   *  matched, else the base. Null when neither exists. */
  effectiveCommission: number | null;
  /** KGS or PCS — the unit the commission is paid on. */
  basis: CommissionBasis;
  source: CommissionSource;
  /** The scope of the winning special ('CUSTOMER' / 'DESIGN' / …), null on base. */
  specialScope: SpecialCommissionScope | null;
  /** Human label for the winning rule, e.g. "Design DL · MANGAL STEEL". */
  specialLabel: string | null;
  /** True when the winning special names a party. These only exist on a
   *  party-specific sheet — see `partyScoped` on the list. */
  partySpecific: boolean;
}

export interface AgentRateList {
  agentId: number;
  agentName: string;
  /** Null on an all-parties sheet. */
  customerId: number | null;
  customerName: string | null;
  /**
   * False when no party was named.
   *
   * The distinction matters enough to print: party-scoped specials CANNOT be
   * resolved without a party, so an all-parties sheet shows base and
   * non-party specials only. Printing it without saying so would understate the
   * commission on exactly the parties that negotiated one.
   */
  partyScoped: boolean;
  generatedAt: string;
  rows: AgentRateListRow[];
  /** How many rows carry a special — the headline the sheet is checked against. */
  specialCount: number;
  /** How many rows have no commission at all (no base, no special). */
  noCommissionCount: number;
}
