import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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
  // Declared or `ValidationPipe({ whitelist: true })` strips it and the
  // dropdown silently filters nothing.
  @IsOptional() @IsString() category?: string;

  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() agent?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() design?: string;
  /** Off (default) → `product` is a BASE item name and also matches its design
   *  variants, because Modify Dispatch's picker lists base names. On → the exact
   *  item only. Same meaning as on {@link PendingQueryDto}. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() all?: boolean;
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
  /** Product category — matched against the line's `pCategory`. */
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCategory?: string;
  /** "ALL" toggle → product matched as a base name (all design variants). */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() all?: boolean;
  /** Excel export only: comma-separated column ids (see DISPATCH_EXPORT_COLUMNS). */
  @IsOptional() @IsString() columns?: string;
}

/** The Dispatch Order screen's bulk row-selection action: mark a batch of still-
 *  pending lines URGENT (or back to NORMAL) in one call instead of opening each
 *  line's own edit form. Capped at 500 — comfortably above a real selection
 *  (the whole pending pool rarely runs that deep on one page), but a bound
 *  rather than an unlimited `updateMany` on whatever a client sends. */
export class BulkSetPendingPriorityDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  orderItemIds!: number[];

  @IsIn(['URGENT', 'NORMAL'])
  priority!: 'URGENT' | 'NORMAL';
}
