/**
 * Work-in-progress New Order draft, persisted to localStorage so a half-filled
 * order survives navigating away / closing the tab and is offered back next time.
 * This is the *local* draft (auto-save); separate from saving an order with the
 * server-side "DRAFT" status.
 */
const KEY = 'oms:order-draft-v1';

export interface OrderDraftData {
  customer: string;
  poNumber: string;
  agentName: string;
  category: string;
  orderDate: string;
  completionDay: string;
  status: string;
  showBy: 'SIZE' | 'PCS';
  /** Added line items (the form's Item[] shape). */
  items: unknown[];
  savedAt: number;
}

export function saveOrderDraft(d: Omit<OrderDraftData, 'savedAt'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function loadOrderDraft(): OrderDraftData | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OrderDraftData) : null;
  } catch {
    return null;
  }
}

export function clearOrderDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
