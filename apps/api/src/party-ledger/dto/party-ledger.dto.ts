import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class PartyLedgerQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() agentName?: string;
  @IsString() from!: string;
  @IsString() to!: string;
  @IsOptional() @IsString() voucherType?: string;
  /** BOTH | B | C. */
  @IsOptional() @IsString() mode?: string;
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
