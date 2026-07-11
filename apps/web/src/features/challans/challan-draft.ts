/**
 * Work-in-progress Create-Challan draft, persisted to localStorage so a half-built
 * challan (customer + priced lines + charge/total edits) survives navigating away or
 * closing the tab, and is offered back next time. This is the web port of the legacy
 * Form14 `TempChallanTbl`, which held the in-progress challan between form sessions.
 * Only for a brand-new challan — editing an existing one loads from the server.
 */
const KEY = 'oms:challan-draft-v1';

export interface ChallanDraftData {
  customer: string;
  invDate: string;
  prefix: string;
  manualCode: string;
  status: string;
  freight: string;
  packing: string;
  pouch: string;
  billingRate: string;
  gstPct: string;
  noBill: boolean;
  noBillRemoveGst: boolean;
  manualTax: string;
  manualB: string;
  manualC: string;
  shippingAddress: string;
  remarks: string;
  /** Added grid rows (the form's Row shape). */
  rows: unknown[];
  savedAt: number;
}

export function saveChallanDraft(d: Omit<ChallanDraftData, 'savedAt'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function loadChallanDraft(): ChallanDraftData | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ChallanDraftData) : null;
  } catch {
    return null;
  }
}

export function clearChallanDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
