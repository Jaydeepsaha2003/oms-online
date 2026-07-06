import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { CHARGES_PAID_BY } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ChequeQueryDto extends PaginationDto {
  /** PENDING | DEPOSITED | CLEARED | BOUNCED (exact). */
  @IsOptional() @IsString() status?: string;
  /** Inclusive receipt-date range (yyyy-mm-dd). */
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
}

/** Add a new (PENDING) cheque — legacy "ADD CHEQUE". A customer must be selected
 *  (customerId), mirroring the legacy "Customer ID is missing" guard. */
export class CreateChequeDto {
  @IsString() @MinLength(1) @MaxLength(255) partyName!: string;
  @Type(() => Number) @IsInt() customerId!: number;
  @IsString() @MinLength(1) @MaxLength(100) chequeNo!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) chequeAmt!: number;
  @IsOptional() @IsString() @MaxLength(255) payeeBank?: string | null;
  @IsString() @MinLength(1) @MaxLength(255) drawerBank!: string;
  @IsString() recDate!: string;
  @IsString() dueDate!: string;
  @IsOptional() @IsString() @MaxLength(1000) comments?: string | null;
}

/** Edit an as-yet-undeposited (PENDING) cheque. */
export class UpdateChequeDto {
  @IsOptional() @IsString() @MaxLength(255) partyName?: string;
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() @MaxLength(100) chequeNo?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) chequeAmt?: number;
  @IsOptional() @IsString() @MaxLength(255) payeeBank?: string | null;
  @IsOptional() @IsString() @MaxLength(255) drawerBank?: string;
  @IsOptional() @IsString() recDate?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(1000) comments?: string | null;
}

/** Deposit a PENDING cheque (must be on/after the due date). */
export class DepositChequeDto {
  @IsString() depositDate!: string;
}

/** Settle a DEPOSITED cheque as CLEARED or BOUNCED (legacy bottom panel). */
export class SettleChequeDto {
  @IsIn(['CLEARED', 'BOUNCED']) status!: string;
  @IsString() acctTransDate!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) bounceCharges?: number | null;
  @IsOptional() @IsIn([...CHARGES_PAID_BY]) chargesPaidBy?: string | null;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isRepresent?: boolean;
}
