import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ADJ_MODES, RECON_REVIEWS, TALLY_LEDGER_CATEGORY_INPUTS } from '@oms/shared';

export class ReconRunsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}

export class SaveAliasDto {
  @IsString() tallyName!: string;
  @Type(() => Number) @IsInt() customerId!: number;
}

/** File one or more ledgers as Party / Expense / Other in one request — a
 *  whole ticked batch, one save. 'PARTY' clears any Expense/Other filing
 *  rather than storing a category for it — see setLedgerCategories. */
export class SetLedgerCategoryDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) tallyNames!: string[];
  @IsIn(TALLY_LEDGER_CATEGORY_INPUTS as unknown as string[]) category!: string;
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
