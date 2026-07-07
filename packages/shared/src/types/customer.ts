/** Customer (and its transporter) shapes shared across the stack. */

import type { Paginated, PaginationQuery } from './common';

/** Fixed dropdown values (from the legacy form). */
export const PARTY_SOURCES = ['SELF', 'AGENT'] as const;
export const PAY_BYS = ['PARTY', 'AGENT'] as const;
export type PartySource = (typeof PARTY_SOURCES)[number];
export type PayBy = (typeof PAY_BYS)[number];

export interface TransporterLite {
  id: number;
  name: string;
  packing: number | null;
  freight: number | null;
}

export interface CustomerDto {
  id: number;
  /** Auto-generated code (e.g. CUST-00001). Server-assigned; shown on export, not on screen. */
  code: string | null;
  partySource: string | null;
  agentName: string | null;
  category: string | null;
  partyName: string | null;
  billingRate: number | null;
  transporterId: number | null;
  transportName: string | null;
  bagName: string | null;
  packing: number | null;
  freight: number | null;
  boxRate: number | null;
  creditPeriod: number | null;
  city: string | null;
  state: string | null;
  region: string | null;
  mobile: string | null;
  email: string | null;
  brand: string | null;
  billRatePc: number | null;
  payBy: string | null;
  /** Whether TDS is deducted at source for this customer, and at what %. */
  tdsApplicable: boolean;
  tdsPercent: number | null;
  /** Active parties appear in every picker; inactive ones are hidden from dropdowns. */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload for create/update. Transporter is resolved by name on the server. */
export interface CustomerInput {
  partySource?: string | null;
  agentName?: string | null;
  category?: string | null;
  partyName: string;
  billingRate?: number | null;
  transportName?: string | null;
  bagName?: string | null;
  packing?: number | null;
  freight?: number | null;
  boxRate?: number | null;
  creditPeriod?: number | null;
  city?: string | null;
  state?: string | null;
  region?: string | null;
  mobile?: string | null;
  email?: string | null;
  brand?: string | null;
  billRatePc?: number | null;
  payBy?: string | null;
  tdsApplicable?: boolean;
  tdsPercent?: number | null;
  active?: boolean;
}

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'ALL'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export interface CustomerQuery extends PaginationQuery {
  // search/sort handled by PaginationQuery
  agentName?: string;
  category?: string;
  /** ACTIVE (default when omitted) | INACTIVE | ALL. Pickers omit it → active-only. */
  status?: string;
}

export type CustomerList = Paginated<CustomerDto>;

/** Dropdown sources for the customer form (distinct existing values + transporters). */
export interface CustomerLookups {
  partySources: string[];
  payBys: string[];
  agents: string[];
  categories: string[];
  brands: string[];
  cities: string[];
  states: string[];
  regions: string[];
  transporters: TransporterLite[];
}
