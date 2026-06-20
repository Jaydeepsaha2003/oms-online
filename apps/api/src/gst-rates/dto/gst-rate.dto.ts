import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class UpsertGstRateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  customerName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rate?: number;
}

export class BulkGstRateDto {
  @IsString()
  @MinLength(1)
  customerName!: string;

  /** [{ category, rate }] — validated/coerced in the service. */
  @IsArray()
  rates!: { category: string; rate: number | null }[];
}

export class GstRateQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  customerName?: string;
}

export class ImportGstRatesDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
