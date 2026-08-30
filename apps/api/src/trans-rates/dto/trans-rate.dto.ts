import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

  /*
   * A number, not an integer.
   *
   * The service rounds with `toInt` (the column is an Int), and the bulk grid
   * path has always done exactly that — so `12.5` saved as 13 from the grid and
   * came back "Validation failed" from the single-rate form. Same value, two
   * answers. It rounds in both places now; see the note on the column if paise
   * are ever needed.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rate?: number;
}

export class BulkTransRateDto {
  @IsString()
  @MinLength(1)
  customerName!: string;

  /** [{ id?, category, type, transportName?, rate }] — coerced in the service.
   *  `id` targets one exact existing row (see TransRateBulkInput). */
  @IsArray()
  rates!: { id?: number | null; category: string; type: string; transportName?: string | null; rate: number | null }[];
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
