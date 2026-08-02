import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ADJ_MODES, RECON_REVIEWS } from '@oms/shared';

export class ReconRunsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}

export class SaveAliasDto {
  @IsString() tallyName!: string;
  @Type(() => Number) @IsInt() customerId!: number;
}

export class CreateReceiptsDto {
  @IsArray() @ArrayNotEmpty() @Type(() => Number) @IsInt({ each: true }) rowIds!: number[];
  @IsOptional() @IsString() bankName?: string | null;
  @IsOptional() @IsIn(ADJ_MODES as unknown as string[]) adjMode?: string;
}

export class MarkRowsDto {
  @IsArray() @ArrayNotEmpty() @Type(() => Number) @IsInt({ each: true }) rowIds!: number[];
  @IsIn(RECON_REVIEWS as unknown as string[]) review!: string;
  @IsOptional() @IsString() note?: string | null;
}
