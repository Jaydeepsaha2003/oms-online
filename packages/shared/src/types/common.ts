/** Shared, transport-level types used by both the API and the web client. */

/** Standard success envelope returned by the API. */
export interface ApiResponse<T> {
  success: true;
  data: T;
  message?: string;
}

/** Standard error envelope returned by the API exception filter. */
export interface ApiError {
  success: false;
  statusCode: number;
  message: string;
  /** Machine-readable error code, e.g. 'VALIDATION_ERROR'. */
  error?: string;
  /** Field-level validation messages, keyed by field name. */
  details?: Record<string, string[]>;
  path?: string;
  timestamp?: string;
}

export type SortOrder = 'asc' | 'desc';

/** Query params for any paginated list endpoint. */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
}

/** Paginated list payload. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const DEFAULT_PAGE_SIZE = 20;
// Allow "load everything" list views (e.g. the sortable Designs grid, the
// customer/agent pickers) to fetch a whole master table in one page.
export const MAX_PAGE_SIZE = 2000;

/** Supported export formats for the SheetJS-powered export endpoints. */
export type ExportFormat = 'xlsx' | 'csv';
