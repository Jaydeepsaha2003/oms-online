import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { LEDGER_TXN_MODES, type LedgerTxnMode } from '@oms/shared';

export class DaybookQueryDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsOptional() @IsString() voucherType?: string;
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  /** BOTH | B | C — which leg the Dr/Cr figures come from. */
  @IsOptional() @IsIn(LEDGER_TXN_MODES as unknown as string[]) mode?: LedgerTxnMode;
}
