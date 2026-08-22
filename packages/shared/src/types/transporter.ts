import type { Paginated, PaginationQuery } from './common';

/** One customer shipping through a transporter — what the count drills into. */
export interface TransporterCustomerDto {
  id: number;
  code: string | null;
  partyName: string;
  agentName: string | null;
  city: string | null;
  state: string | null;
  mobile: string | null;
}

export interface TransporterDto {
  id: number;
  /** Auto-generated code (e.g. TRN-00001). Server-assigned; shown on export, not on screen. */
  code: string | null;
  name: string;
  packing: number | null;
  freight: number | null;
  /** ACTIVE customers on this transporter. Inactive parties are excluded — the
   *  column is read as "who ships with them", and a closed account does not. */
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
