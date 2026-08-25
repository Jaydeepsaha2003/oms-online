import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, MinLength, NotEquals } from 'class-validator';
import { RATE_ADJUST_MODES, type RateAdjustMode } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** Replace the per-category price-calc field map (coerced in the service). */
export class SetCategoryFieldsDto {
  @IsArray()
  fields!: { category: string; field: string }[];
}

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  subCategory!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  product!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  size?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pcs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rate?: number;

  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() showOnRateList?: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

/** Inline toggle of a product's active / rate-list flags (partial — leaves other fields intact). */
export class SetProductFlagsDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() showOnRateList?: boolean;
}

/** Same flags, applied to many products at once (bulk row-selection actions). */
export class BulkSetProductFlagsDto {
  @IsArray() @ArrayNotEmpty() @Type(() => Number) @IsInt({ each: true }) ids!: number[];
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() showOnRateList?: boolean;
}

/**
 * A bulk chart-rate adjustment.
 *
 * `value` is signed and may be negative (a reduction); it may not be zero,
 * which would be a write that changes nothing while still stamping a rate-history
 * row against every product in the category.
 */
export class BulkRateChangeDto {
  @IsString() @MaxLength(255) category!: string;
  @IsOptional() @IsString() @MaxLength(255) subCategory?: string | null;
  @IsIn([...RATE_ADJUST_MODES]) mode!: RateAdjustMode;
  @Type(() => Number) @IsNumber() @NotEquals(0) value!: number;
  @IsOptional() @IsBoolean() roundToRupee?: boolean;
  @IsOptional() @IsBoolean() activeOnly?: boolean;
}

export class ProductQueryDto extends PaginationDto {
  /** Exact-match list filters (Products page dropdowns). */
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCategory?: string;
}

export class ImportProductsDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
