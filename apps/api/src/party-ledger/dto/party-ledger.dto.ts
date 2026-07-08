import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class PartyLedgerQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() agentName?: string;
  @IsString() from!: string;
  @IsString() to!: string;
  @IsOptional() @IsString() voucherType?: string;
  /** BOTH | B | C. */
  @IsOptional() @IsString() mode?: string;
}

export class LedgerReceiptsQueryDto {
  @IsString() invNo!: string;
}
