import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { REPORT_BOOKS, type ReportBook } from '@oms/shared';

/** Shared query filters for every report endpoint. All optional. */
export class ReportFilterDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value))) @IsInt() customerId?: number;
  @IsOptional() @IsString() agent?: string;
  @IsOptional() @IsString() region?: string;
  /** Order Journey: 'true'/'1' limits to orders with quantity still to dispatch. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() activeOnly?: boolean;
  /** Sales & Revenue: BANK or CASH part of each bill only; absent = both. */
  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value)) @IsIn(REPORT_BOOKS) book?: ReportBook;
}
