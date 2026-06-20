import type { Paginated, PaginationQuery } from './common';
import type { TransporterLite } from './customer';

export interface TransRateDto {
  id: number;
  customerId: number | null;
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
