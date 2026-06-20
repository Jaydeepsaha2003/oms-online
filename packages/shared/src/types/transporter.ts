import type { Paginated, PaginationQuery } from './common';

export interface TransporterDto {
  id: number;
  name: string;
  packing: number | null;
  freight: number | null;
  customerCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TransporterInput {
  name: string;
  packing?: number | null;
  freight?: number | null;
}

export type TransporterQuery = PaginationQuery;
export type TransporterList = Paginated<TransporterDto>;
