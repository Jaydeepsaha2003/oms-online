import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ADJ_MODES, PAY_MODES, TAKE_ACC_ON } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class PaymentContextQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() agentName?: string;
  /** Receipt date (yyyy-mm-dd) — invoices dated after it are excluded. */
  @IsOptional() @IsString() recDate?: string;
}

export class LedgerQueryDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() agentName?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
}

export class SavePaymentDto {
  @IsIn(TAKE_ACC_ON as unknown as string[]) takeAccOn!: string;
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number | null;
  @IsOptional() @IsString() agentName?: string | null;
  @IsIn(PAY_MODES as unknown as string[]) payMode!: string;
  @IsOptional() @IsString() bankName?: string | null;
  @IsOptional() @IsString() chequeNo?: string | null;
  @IsOptional() @IsString() cashTransLocation?: string | null;
  @IsOptional() @IsString() cashRecBy?: string | null;
  @IsIn(ADJ_MODES as unknown as string[]) adjMode!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) selectedInvNos?: string[];
  @Type(() => Number) @IsNumber() receiptAmt!: number;
  @IsString() recDate!: string;
  @IsOptional() @IsString() remarks?: string | null;
}
