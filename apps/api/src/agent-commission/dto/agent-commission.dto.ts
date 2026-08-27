import { OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import {
  AGENT_COVER_MODES,
  AGENT_DEDUCTION_KINDS,
  AGENT_PAY_MODES,
  COMMISSION_BASES,
  SPECIAL_COMMISSION_SCOPES,
  type SpecialCommissionScope,
} from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class AgentCommissionQueryDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() agentId?: number;
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() pCategory?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  /** UNSETTLED (default) | SETTLED | ALL */
  @IsOptional() @IsString() settledState?: string;
}

export class CreateRateDto {
  @Type(() => Number) @IsInt() agentId!: number;
  @IsString() pCategory!: string;
  /** KGS or PCS — the unit this category's commission is charged in. */
  @IsIn([...COMMISSION_BASES], { message: 'Choose whether this category is charged per kg or per piece.' }) basis!: (typeof COMMISSION_BASES)[number];
  @Type(() => Number) @IsNumber({}, { message: 'The rate must be a number.' }) @Min(0, { message: 'The rate cannot be negative.' }) ratePerUnit!: number;
  @IsString() effectiveFrom!: string;
  @IsOptional() @IsString() note?: string;
  /** Charge this rate through to the customer as well as paying the agent — see
   *  `addToRate` on AgentCommissionRateDto. A base rate names no party, so this
   *  reaches every party the agent sells to in the category. */
  @IsOptional() @IsBoolean() addToRate?: boolean;
}

export class CreateCoverDto {
  @Type(() => Number) @IsInt() agentId!: number;
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsString() customerName!: string;
  @IsOptional() @IsString() invNo?: string;
  @Type(() => Number) @IsNumber({}, { message: 'The amount must be a number.' }) @Min(0.01, { message: 'The amount covered must be more than zero.' }) amount!: number;
  @IsIn([...AGENT_COVER_MODES], { message: 'How the agent handed the money over must be cash, bank, or adjusted against commission.' }) mode!: (typeof AGENT_COVER_MODES)[number];
  @IsString() coveredAt!: string;
  @IsOptional() @IsString() remarks?: string;
}

/**
 * §7 — asked while the cheque is still being typed, so everything is optional
 * except the date and amount the owner has just keyed in.
 */
export class ChequeTimingQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @IsOptional() @IsString() partyName?: string;
  @IsString() chequeDate!: string;
  @Type(() => Number) @IsNumber() @Min(0) chequeAmount!: number;
  @IsOptional() @IsString() agentName?: string;
  @IsOptional() @IsString() chequeNo?: string;
  /** Repeatable query param; a lone value arrives as a string. */
  @IsOptional() @Transform(({ value }) => (Array.isArray(value) ? value : value == null ? [] : [value]))
  @IsArray() @IsString({ each: true })
  invoiceNos?: string[];
}

export class CreateBankBounceChargeDto {
  @IsString() bankName!: string;
  @Type(() => Number) @IsNumber({}, { message: 'The bounce charge must be a number.' }) @Min(0, { message: 'The bounce charge cannot be negative.' }) charge!: number;
  @Type(() => Number) @IsNumber({}, { message: 'GST must be a number.' }) @Min(0, { message: 'GST cannot be negative.' }) gstPercent!: number;
}

export class CreateBounceEventDto {
  @Type(() => Number) @IsInt() chequeId!: number;
  @IsString() bounceDate!: string;
  @IsOptional() @IsString() bankName?: string;
  /** Omitted → the bank's configured charge is used. */
  @IsOptional() @Type(() => Number) @IsNumber({}, { message: 'The bounce charge must be a number.' }) @Min(0, { message: 'The bounce charge cannot be negative.' }) charge?: number;
  @IsOptional() @Type(() => Number) @IsNumber({}, { message: 'GST must be a number.' }) @Min(0, { message: 'GST cannot be negative.' }) gstPercent?: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() receiptUrl?: string;
  @IsOptional() @IsString() receiptPath?: string;
}

class SettlementLineDto {
  @IsOptional() @Type(() => Number) @IsInt() challanId?: number;
  @IsString() invNo!: string;
  @IsString() customerName!: string;
  @IsString() pCategory!: string;
  @IsIn([...COMMISSION_BASES]) basis!: (typeof COMMISSION_BASES)[number];
  @Type(() => Number) @IsNumber() qty!: number;
  @Type(() => Number) @IsNumber() baseRatePerUnit!: number;
  @Type(() => Number) @IsNumber() @Min(0) appliedRatePerUnit!: number;
  @Type(() => Number) @IsNumber() paidRatio!: number;
  @Type(() => Number) @IsNumber() invoiceAmount!: number;
  @Type(() => Number) @IsNumber() paidAmount!: number;
  @Type(() => Number) @IsNumber() amount!: number;
  @IsOptional() @IsString() reason?: string;
  /** Carried from the preview so a saved settlement can still explain itself. */
  @IsOptional() @IsBoolean() isTopUp?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) previouslySettledRatio?: number;
}

class SettlementDeductionDto {
  @IsIn([...AGENT_DEDUCTION_KINDS]) kind!: (typeof AGENT_DEDUCTION_KINDS)[number];
  @IsOptional() @Type(() => Number) @IsInt() bounceEventId?: number;
  @IsOptional() @Type(() => Number) @IsInt() coverId?: number;
  @IsOptional() @IsString() chequeNo?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() refDate?: string;
  @Type(() => Number) @IsNumber() amount!: number;
  @IsOptional() @IsString() note?: string;
}

export class CreateSettlementDto {
  @Type(() => Number) @IsInt() agentId!: number;
  @IsString() periodFrom!: string;
  @IsString() periodTo!: string;
  @IsOptional() @IsIn([...AGENT_PAY_MODES]) payMode?: (typeof AGENT_PAY_MODES)[number];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) tdsPercent?: number;
  @IsOptional() @IsString() remarks?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SettlementLineDto) lines!: SettlementLineDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => SettlementDeductionDto) deductions!: SettlementDeductionDto[];
}

export class PaySettlementDto {
  @IsIn([...AGENT_PAY_MODES], { message: 'Say whether the agent is being paid in cash or by bank transfer.' }) payMode!: (typeof AGENT_PAY_MODES)[number];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) tdsPercent?: number;
  @IsOptional() @IsString() paidAt?: string;
  @IsOptional() @IsString() remarks?: string;
}

/** Add a Special Commission rule. The `scope` decides which of the narrowing
 *  fields are required — enforced in the service, where the party lookup is. */
export class CreateSpecialCommissionDto {
  @Type(() => Number) @IsInt() agentId!: number;
  @IsIn([...SPECIAL_COMMISSION_SCOPES], { message: 'Choose what this rule applies to.' })
  scope!: SpecialCommissionScope;
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number | null;
  @IsOptional() @IsString() pCategory?: string | null;
  @IsOptional() @IsString() subCategory?: string | null;
  @IsOptional() @IsString() product?: string | null;
  @IsOptional() @IsString() designType?: string | null;
  @IsIn([...COMMISSION_BASES], { message: 'Choose whether this rate is per kg or per piece.' })
  basis!: (typeof COMMISSION_BASES)[number];
  @Type(() => Number) @IsNumber({}, { message: 'The rate must be a number.' })
  @Min(0, { message: 'The rate cannot be negative.' })
  ratePerUnit!: number;
  @IsString() effectiveFrom!: string;
  @IsOptional() @IsString() note?: string;
  /** Fold this rate into the named party's product rate instead of paying it
   *  out of margin the normal way. Only valid alongside a `customerId` — the
   *  service rejects it otherwise. Defaults to false. */
  @IsOptional() @IsBoolean() addToRate?: boolean;
}

/**
 * The same special rule for several parties.
 *
 * Deliberately NOT `CreateSpecialCommissionDto` with an extra array: that would
 * leave both `customerId` and `customerIds` on one payload, and nothing to say
 * which wins. This carries the list only.
 */
export class BulkSpecialCommissionDto extends OmitType(CreateSpecialCommissionDto, ['customerId'] as const) {
  @IsArray() @IsInt({ each: true }) customerIds!: number[];
}

/** "What rate would apply here?" — the Special Commission screen's tester. */
export class TestRateQueryDto {
  @Type(() => Number) @IsInt() agentId!: number;
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number | null;
  @IsOptional() @IsString() pCategory?: string | null;
  @IsOptional() @IsString() subCategory?: string | null;
  @IsOptional() @IsString() product?: string | null;
  @IsOptional() @IsString() designType?: string | null;
  /** Defaults to today — the rate history is date-effective. */
  @IsOptional() @IsString() on?: string | null;
}

/** "How many invoices would a rate dated X reach?" — shown in the rate dialog
 *  before saving, so a date that prices nothing is visible rather than a
 *  surprise. */
export class RateImpactQueryDto {
  @Type(() => Number) @IsInt() agentId!: number;
  @IsOptional() @IsString() pCategory?: string | null;
  @IsOptional() @IsString() effectiveFrom?: string | null;
}
