import type { Paginated, PaginationQuery } from './common';

export interface TransporterDto {
  id: number;
  /** Auto-generated code (e.g. TRN-00001). Server-assigned; shown on export, not on screen. */
  code: string | null;
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
