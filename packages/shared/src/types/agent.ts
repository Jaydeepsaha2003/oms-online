import type { Paginated, PaginationQuery } from './common';

export interface AgentDto {
  id: number;
  name: string;
  contactNo: string | null;
  state: string | null;
  city: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInput {
  name: string;
  contactNo?: string | null;
  state?: string | null;
  city?: string | null;
}

export type AgentQuery = PaginationQuery;
export type AgentList = Paginated<AgentDto>;
