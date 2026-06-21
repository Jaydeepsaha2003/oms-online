import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class UpsertTransRateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  customerName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  category!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  transportName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rate?: number;
}

export class BulkTransRateDto {
  @IsString()
  @MinLength(1)
  customerName!: string;

  /** [{ category, type, transportName?, rate }] — coerced in the service. */
  @IsArray()
  rates!: { category: string; type: string; transportName?: string | null; rate: number | null }[];
}

export class TransRateQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  customerName?: string;
}

export class ImportTransRatesDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
