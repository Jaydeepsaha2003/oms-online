import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ADJ_MODES, PAY_MODES, TAKE_ACC_ON } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class PaymentContextQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() agentName?: string;
  /** Receipt date (yyyy-mm-dd) — invoices dated after it are excluded. */
  @IsOptional() @IsString() recDate?: string;
  /**
   * The mode being collected, which decides the money bucket and therefore WHICH
   * parties are reachable: a party whose cash comes through its agent is listed
   * under that agent for CASH and under itself for BANK.
   *
   * Optional, and absent means BANK — the same default the screen opens on.
   */
  @IsOptional() @IsIn(PAY_MODES as unknown as string[]) payMode?: string;
}

export class LedgerQueryDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() agentName?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  /** 'B' bank side only, 'C' cash side only. Anything else (or absent) = both. */
  @IsOptional() @IsIn(['B', 'C', 'BOTH']) mode?: string;
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

/** Correct an already-saved receipt's amount/date/mode/remarks. WHO it was
 *  taken from and HOW it was adjusted stay fixed — see PaymentsService.editReceipt. */
/**
 * The receipts to delete together.
 *
 * Capped at 50: each id drags its party's later-receipt chain through a reverse
 * and replay inside one transaction, and an unbounded list would let a stray
 * request hold a write lock on the whole payments book. Fifty is far more than
 * anyone ticks by hand on a 25-row page.
 */
export class BulkDeletePaymentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  ids!: number[];
}

export class EditPaymentDto {
  @IsIn(PAY_MODES as unknown as string[]) payMode!: string;
  @IsOptional() @IsString() bankName?: string | null;
  @IsOptional() @IsString() chequeNo?: string | null;
  @IsOptional() @IsString() cashTransLocation?: string | null;
  @IsOptional() @IsString() cashRecBy?: string | null;
  @Type(() => Number) @IsNumber() receiptAmt!: number;
  @IsString() recDate!: string;
  @IsOptional() @IsString() remarks?: string | null;
}

/** One line of the Pending Invoices export, exactly as the screen showed it. */
export class PendingReportRowDto {
  @IsOptional() @IsString() invDate?: string | null;
  @IsString() invNo!: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() transaction?: string;
  @IsOptional() @IsString() dueDate?: string | null;
  @IsOptional() @IsString() dueType?: string;
  @IsNumber() amt!: number;
  @IsNumber() adj!: number;
  @IsNumber() bal!: number;
  @IsOptional() @IsString() dueDays?: string;
}

/**
 * The Pending Invoices export.
 *
 * The rows are POSTED rather than re-queried because the ADJ AMT column is the
 * allocation the user is composing on screen and has not saved — there is no
 * query that could reproduce it.
 */
export class PendingReportDto {
  @IsString() owner!: string;
  @IsString() ownerKind!: string;
  @IsOptional() @IsString() payMode?: string;
  @IsString() asOf!: string;
  @IsString() bucket!: string;
  @IsOptional() @IsBoolean() showParty?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PendingReportRowDto)
  rows!: PendingReportRowDto[];
}
