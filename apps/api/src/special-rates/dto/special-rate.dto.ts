import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class SaveCustomerRateDto {
  @IsInt() customerId!: number;
  @IsIn(['PRODUCT', 'DESIGN']) kind!: 'PRODUCT' | 'DESIGN';
  @IsIn(['CATEGORY', 'SUBCATEGORY', 'ITEM']) scope!: 'CATEGORY' | 'SUBCATEGORY' | 'ITEM';
  @IsString() @MaxLength(255) category!: string;
  @IsOptional() @IsString() @MaxLength(255) subCategory?: string;
  @IsOptional() @IsString() @MaxLength(255) target?: string;
  @IsNumber() rate!: number;
}

export class SaveCustomerLogoDto {
  @IsInt() customerId!: number;
  @IsIn(['CATEGORY', 'SUBCATEGORY']) scope!: 'CATEGORY' | 'SUBCATEGORY';
  @IsString() @MaxLength(255) category!: string;
  @IsOptional() @IsString() @MaxLength(255) subCategory?: string;
}

export class SpecialRateQueryDto {
  @Type(() => Number) @IsInt() customerId!: number;
}

export class AgentQueryDto {
  @IsString() agentName!: string;
}

export class SpecialRateMasterQueryDto extends PaginationDto {
  /** Omitted means ACTIVE — see SpecialRatesService.masterList. */
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ALL']) active?: 'ACTIVE' | 'INACTIVE' | 'ALL';
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() agent?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() scope?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCategory?: string;
}

export class BulkSaveCustomerRateDto {
  @IsArray() @ArrayNotEmpty() @IsInt({ each: true }) customerIds!: number[];
  @IsIn(['PRODUCT', 'DESIGN']) kind!: 'PRODUCT' | 'DESIGN';
  @IsIn(['CATEGORY', 'SUBCATEGORY', 'ITEM']) scope!: 'CATEGORY' | 'SUBCATEGORY' | 'ITEM';
  @IsString() @MaxLength(255) category!: string;
  @IsOptional() @IsString() @MaxLength(255) subCategory?: string;
  @IsOptional() @IsString() @MaxLength(255) target?: string;
  @IsNumber() rate!: number;
}

export class BulkSaveCustomerLogoDto {
  @IsArray() @ArrayNotEmpty() @IsInt({ each: true }) customerIds!: number[];
  @IsIn(['CATEGORY', 'SUBCATEGORY']) scope!: 'CATEGORY' | 'SUBCATEGORY';
  @IsString() @MaxLength(255) category!: string;
  @IsOptional() @IsString() @MaxLength(255) subCategory?: string;
}

export class SaveCustomerBagWeightDto {
  @IsInt() customerId!: number;
  @IsString() @MaxLength(255) category!: string;
  @IsNumber() @Min(0.001) kgsPerBag!: number;
  /** Omit to leave any existing threshold untouched is NOT supported — this is
   *  a full upsert, so pass null explicitly to clear a previously-set one. */
  @IsOptional() @IsNumber() @Min(0.001) maxBagsPerDispatch?: number | null;
}

export class BulkSaveCustomerBagWeightDto {
  @IsArray() @ArrayNotEmpty() @IsInt({ each: true }) customerIds!: number[];
  @IsString() @MaxLength(255) category!: string;
  @IsNumber() @Min(0.001) kgsPerBag!: number;
  @IsOptional() @IsNumber() @Min(0.001) maxBagsPerDispatch?: number | null;
}
