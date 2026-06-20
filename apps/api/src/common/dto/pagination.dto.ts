import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type SortOrder } from '@oms/shared';

/** Reusable query DTO for paginated/sortable/searchable list endpoints. */
export class PaginationDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => Math.min(parseInt(value, 10) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: SortOrder = 'desc';

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }
}
