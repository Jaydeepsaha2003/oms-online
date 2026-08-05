import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateDispatchDto {
  @IsInt()
  orderItemId!: number;

  @IsOptional() @IsNumber() @Min(0) bags?: number;
  @IsOptional() @IsNumber() @Min(0) pcs?: number;
  @IsOptional() @IsNumber() @Min(0) gram?: number;
  @IsOptional() @IsNumber() @Min(0) box?: number;

  @IsIn(['PARTIALLY DISPATCH', 'FULLY DISPATCH']) dispatchStatus!: 'PARTIALLY DISPATCH' | 'FULLY DISPATCH';

  @IsOptional() @IsString() @MaxLength(255) comment?: string;
  @IsOptional() @IsString() @MaxLength(255) supItem?: string;
  @IsOptional() @IsString() dispatchDate?: string;
}

export class UpdateDispatchDto extends PartialType(CreateDispatchDto) {}

export class DispatchQueryDto extends PaginationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() agent?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() design?: string;
  /** Dispatch-date range (inclusive), 'YYYY-MM-DD' — Modify Dispatch's Date filter
   *  and the Group-by-Date-&-Party view. */
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
}

export class PendingQueryDto extends PaginationDto {
  @IsOptional() @IsString() dueType?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() agent?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() design?: string;
  @IsOptional() @IsString() subCategory?: string;
  /** "ALL" toggle → product matched as a base name (all design variants). */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() all?: boolean;
  /** Excel export only: comma-separated column ids (see DISPATCH_EXPORT_COLUMNS). */
  @IsOptional() @IsString() columns?: string;
}
