import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateDesignDto {
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
  designType!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rate?: number;

  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() showOnRateList?: boolean;
}

export class UpdateDesignDto extends PartialType(CreateDesignDto) {}

/**
 * The same design type across several sub-categories — see `BulkDesignInput`
 * in @oms/shared for why. `subCategory` is replaced by the list, so there is
 * never both a single and a plural field with nothing to say which wins.
 */
export class BulkDesignsDto extends OmitType(CreateDesignDto, ['subCategory'] as const) {
  @IsArray()
  @ArrayNotEmpty({ message: 'Choose at least one sub-category.' })
  @IsString({ each: true })
  subCategories!: string[];
}

/** Inline toggle of a design's active / rate-list flags (partial). */
export class SetDesignFlagsDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() showOnRateList?: boolean;
}

export class DesignQueryDto extends PaginationDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCategory?: string;
  /** standalone = used in no combination; combined = used in at least one. */
  @IsOptional() @IsIn(['standalone', 'combined']) combinationStatus?: 'standalone' | 'combined';
}

export class ImportDesignsDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
