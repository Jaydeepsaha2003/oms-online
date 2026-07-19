/** User-editable option lists surfaced on the Settings page and used by forms. */

export const SETTING_GROUPS = ['COMPLETION_DAYS', 'ORDER_TYPE', 'QUOTATION_CANCEL_REASON'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export interface OrderOptionDto {
  id: number;
  group: string;
  value: string;
  sortOrder: number;
}

/** Company branding shown on printed documents (bill / invoice / quotation). */
export interface CompanyProfileDto {
  name: string | null;
  /** Logo as a base64 data URL (e.g. "data:image/png;base64,…") or null. */
  logo: string | null;
}

export interface CompanyProfileInput {
  name?: string | null;
  logo?: string | null;
}

/** Sales Order / Quotation bill's "Terms & Conditions" list — editable in Settings. */
export interface OrderTermsDto {
  terms: string[];
}

export interface OrderTermsInput {
  terms: string[];
}

/** Sales Order / Quotation bill's footer text lines — editable in Settings.
 *  A line containing the token "{DOC_TYPE}" has it replaced with "SALES ORDER" or "QUOTATION" when printed. */
export interface OrderFooterDto {
  lines: string[];
}

export interface OrderFooterInput {
  lines: string[];
}

/** Challan / Tax Invoice bill's "Terms & Conditions" list — editable in Settings.
 *  Empty by default (no terms printed) until the business saves its own list. */
export interface ChallanTermsDto {
  terms: string[];
}

export interface ChallanTermsInput {
  terms: string[];
}

export interface OrderOptionInput {
  group: string;
  value: string;
}

export interface SettingGroupMeta {
  group: SettingGroup;
  label: string;
  description: string;
  /** Values are whole numbers (e.g. completion days). */
  numeric: boolean;
  placeholder: string;
}

/** The setting groups the UI knows how to render, in display order. */
export const SETTING_GROUP_META: SettingGroupMeta[] = [
  {
    group: 'COMPLETION_DAYS',
    label: 'Completion Days',
    description: 'Delivery durations (in days) selectable when creating an order.',
    numeric: true,
    placeholder: 'e.g. 7',
  },
  {
    group: 'ORDER_TYPE',
    label: 'Order Types',
    description: 'Order type options available on order line items.',
    numeric: false,
    placeholder: 'e.g. SALES ORDER',
  },
  {
    group: 'QUOTATION_CANCEL_REASON',
    label: 'Quotation Cancellation Reasons',
    description: 'Reasons selectable when cancelling a quotation — used for analysis.',
    numeric: false,
    placeholder: 'e.g. PRICE TOO HIGH',
  },
];
