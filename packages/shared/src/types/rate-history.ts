/** Audit trail of GST / transport rate changes (old → new), so past rates stay visible. */

export interface RateHistoryEntry {
  id: number;
  kind: 'GST' | 'TRANS';
  customerName: string;
  category: string;
  /** Transport only. */
  type: string | null;
  transportName: string | null;
  oldRate: number | null;
  newRate: number | null;
  changedByName: string | null;
  changedAt: string;
}
