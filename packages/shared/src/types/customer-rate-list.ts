/**
 * Per-customer Rate List (Customers → Rate List).
 *
 * Two shapes:
 *  - {@link CustomerRateList} — the customer's CURRENT effective rate sheet (every
 *    product/design at base rate + this customer's special-rate adjustment). This is
 *    what the PDF/Excel download produces, mirroring the printed "RATE LIST" sheet.
 *  - the on-screen change history reuses {@link RateChangeEntry} (CUSTOMER kind),
 *    filtered to one customer and grouped by change timestamp on the client.
 */

/** One product line on a customer's effective rate list. */
export interface CustomerRateListProduct {
  category: string;
  subCategory: string;
  product: string;
  size: number | null;
  pcs: number | null;
  weight: number | null;
  /** Base chart rate. */
  baseRate: number;
  /** This customer's special-rate delta applied (0 when none). */
  delta: number;
  /** Effective rate the customer pays = baseRate + delta. */
  rate: number;
  /** Which special-rate level supplied the delta (ITEM/SUBCATEGORY/CATEGORY) or null. */
  from: string | null;
}

/** One design line on a customer's effective rate list (rates are per-kg add-ons). */
export interface CustomerRateListDesign {
  category: string;
  subCategory: string;
  designType: string;
  baseRate: number;
  delta: number;
  rate: number;
  from: string | null;
}

/** A customer's full current effective rate list (products + designs). */
export interface CustomerRateList {
  customerId: number;
  customerName: string;
  /** ISO timestamp the list was generated (stamped on the export header). */
  generatedAt: string;
  products: CustomerRateListProduct[];
  designs: CustomerRateListDesign[];
}
