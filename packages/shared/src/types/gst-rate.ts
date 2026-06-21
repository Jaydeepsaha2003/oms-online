import type { Paginated, PaginationQuery } from './common';

export interface GstRateDto {
  id: number;
  customerId: number | null;
  customerCode: string | null;
  customerName: string;
  category: string;
  rate: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Add/update a single customer + product-category GST rate (upsert key). */
export interface GstRateInput {
  customerName: string;
  category: string;
  rate?: number | null;
}

/** Save many category rates for one customer at once (the "bulk update"). */
export interface GstRateBulkInput {
  customerName: string;
  rates: { category: string; rate: number | null }[];
}

export interface GstRateQuery extends PaginationQuery {
  customerName?: string;
}

export interface GstRateLookups {
  customers: string[];
  categories: string[];
}

export type GstRateList = Paginated<GstRateDto>;
