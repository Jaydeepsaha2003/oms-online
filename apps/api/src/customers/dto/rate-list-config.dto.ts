import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AVAILABLE_DISPLAYS, AVAILABLE_OVERRIDE_SCOPES, type AvailableDisplay, type AvailableOverrideScope } from '@oms/shared';

/** One saved price combination (§7). The equal-rate rule of §8 is enforced in
 *  the service, where the live rates are — not here. */
export class RateListCombinationDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() label?: string;
  @IsArray() @IsString({ each: true }) members!: string[];
}

/**
 * One Available-column exception inside a category.
 *
 * Only the shape is checked here. Whether a row actually identifies something —
 * a SUBCATEGORY rule needs a sub-category, an ITEM rule needs an item — is
 * decided in the service, which drops the ones that cannot mean anything rather
 * than failing the whole save over a half-filled new row.
 */
export class RateListAvailableOverrideDto {
  @IsOptional() @IsString() id?: string;
  @IsIn([...AVAILABLE_OVERRIDE_SCOPES]) scope!: AvailableOverrideScope;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsString() target?: string;
  @IsIn([...AVAILABLE_DISPLAYS]) display!: AvailableDisplay;
}

export class RateListCategoryConfigDto {
  @IsString() category!: string;
  @IsOptional() @IsBoolean() included?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) subCategories?: string[];
  @IsOptional() @IsIn([...AVAILABLE_DISPLAYS]) availableDisplay?: AvailableDisplay | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RateListAvailableOverrideDto)
  availableOverrides?: RateListAvailableOverrideDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RateListCombinationDto)
  combinations?: RateListCombinationDto[];
}

/** The DEFAULT configuration (§9). */
export class SaveRateListConfigDto {
  @IsIn([...AVAILABLE_DISPLAYS]) availableDisplay!: AvailableDisplay;
  @IsOptional() @IsBoolean() includeDesigns?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RateListCategoryConfigDto)
  categories?: RateListCategoryConfigDto[];
}

/** A party's configuration (§10). Every field optional — a party overrides only
 *  what it wants different and inherits the rest. */
export class SavePartyRateListConfigDto {
  @IsOptional() @IsIn([...AVAILABLE_DISPLAYS]) availableDisplay?: AvailableDisplay | null;
  @IsOptional() @IsBoolean() includeDesigns?: boolean | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RateListCategoryConfigDto)
  categories?: RateListCategoryConfigDto[] | null;
}

/** "Can these share one price column?" (§8) */
export class CheckCombinationDto {
  @IsString() category!: string;
  @IsArray() @IsString({ each: true }) subCategories!: string[];
  @IsOptional() @IsIn(['PRODUCT', 'DESIGN']) kind?: 'PRODUCT' | 'DESIGN';
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number | null;
}
