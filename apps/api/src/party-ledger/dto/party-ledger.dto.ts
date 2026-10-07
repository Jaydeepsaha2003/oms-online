import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { LEDGER_DUE_FILTERS, type LedgerDueFilter } from '@oms/shared';

export class PartyLedgerQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() agentName?: string;
  @IsOptional() @Type(() => Number) @IsInt() groupId?: number;
  @IsString() from!: string;
  @IsString() to!: string;
  @IsOptional() @IsString() voucherType?: string;
  @IsOptional() @IsIn(LEDGER_DUE_FILTERS.map((f) => f.value)) dueType?: LedgerDueFilter;
  /** BOTH | B | C. */
  @IsOptional() @IsString() mode?: string;
  /** Exports only: the columns to include, comma-separated. */
  @IsOptional() @IsString() cols?: string;
}

/** Which receipt voucher to explain. */
export class LedgerClearedQueryDto {
  @IsString() voucherNo!: string;
}

export class LedgerReceiptsQueryDto {
  @IsString() invNo!: string;
  /** The grid's own Bank/Cash toggle: 'B' bank only, 'C' cash only, else both. */
  @IsOptional() @IsIn(['B', 'C', 'BOTH']) mode?: string;
}

/** Party Ledger → "Save this range". */
export class SavePartyLedgerPeriodDto {
  @Type(() => Number) @IsInt() customerId!: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

export class PartyLedgerPeriodsQueryDto {
  @Type(() => Number) @IsInt() customerId!: number;
}
