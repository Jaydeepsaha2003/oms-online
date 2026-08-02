import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ADJ_MODES } from '@oms/shared';

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
