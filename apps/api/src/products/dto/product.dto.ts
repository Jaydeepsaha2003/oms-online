import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ProductQueryDto extends PaginationDto {}

export class ImportProductsDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
