import type { Paginated, PaginationQuery } from './common';
import type { TransporterLite } from './customer';

export interface TransRateDto {
  id: number;
  customerId: number | null;
  customerCode: string | null;
  customerName: string;
  category: string;
  type: string;
  transporterId: number | null;
  transportName: string | null;
  rate: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Add/update one rate; upsert key = customer + category + type + transporter. */
export interface TransRateInput {
  customerName: string;
  category: string;
  type: string;
  transportName?: string | null;
  rate?: number | null;
}

/** Save many category×type rates for one customer in a single call (the grid editor).
 *  Pass `id` to update one exact row — the same customer + category + type can
 *  exist more than once (one row per transporter), and without an id the server
 *  can only guess which of them you meant. With no `id` the key is
 *  customer + category + type, preferring the row whose transporter matches. */
export interface TransRateBulkInput {
  customerName: string;
  rates: { id?: number | null; category: string; type: string; transportName?: string | null; rate: number | null }[];
}

export interface TransRateQuery extends PaginationQuery {
  customerName?: string;
}

export interface TransRateLookups {
  customers: string[];
  categories: string[];
  types: string[];
  transporters: TransporterLite[];
}

export type TransRateList = Paginated<TransRateDto>;
