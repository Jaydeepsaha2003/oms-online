import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CHALLAN_STATUSES } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class PendingChallanQueryDto extends PaginationDto {
  /** Inclusive dispatch-date range (yyyy-mm-dd). */
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  /** Restrict to one party (exact match) — used by the standalone Create Challan picker. */
  @IsOptional() @IsString() customerName?: string;
}

export class ChallanQueryDto extends PaginationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
}

export class UpdateChallanStatusDto {
  @IsIn(CHALLAN_STATUSES as unknown as string[]) challanStatus!: string;
}

export class SavePrefixSettingsDto {
  @IsArray() @IsString({ each: true }) prefixes!: string[];
  @IsOptional() @IsString() default?: string;
}

export class ItemHistoryQueryDto extends PaginationDto {
  @IsOptional() @IsString() product?: string;
}

export class DraftChallanDto {
  @IsString() customerName!: string;
  /** Specific lines to price; omit to price the customer's entire un-challaned pool. */
  @IsOptional() @IsArray() @IsInt({ each: true }) dispatchIds?: number[];
}

export class CreateChallanItemDto {
  @IsOptional() @IsInt() dispatchId?: number | null;
  @IsOptional() @IsString() productName?: string | null;
  @IsOptional() @IsString() design?: string | null;
  @IsOptional() @IsNumber() bags?: number | null;
  @IsOptional() @IsNumber() pcs?: number | null;
  @IsOptional() @IsNumber() kgs?: number | null;
  @IsOptional() @IsNumber() box?: number | null;
  @IsOptional() @IsString() unit?: string | null;
  @IsOptional() @IsNumber() price?: number | null;
  @IsOptional() @IsNumber() amount?: number | null;
  @IsOptional() @IsString() pCategory?: string | null;
  @IsOptional() @IsString() comment?: string | null;
}

export class CreateChallanDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() prefix?: string;
  @IsOptional() @IsString() invDate?: string;
  @IsOptional() @IsInt() customerId?: number | null;
  @IsString() customerName!: string;
  @IsOptional() @IsString() billingAddress?: string | null;
  @IsOptional() @IsString() shippingAddress?: string | null;
  @IsOptional() @IsString() category?: string | null;
  @IsOptional() @IsInt() paymentTerm?: number | null;
  @IsOptional() @IsString() dueDate?: string | null;
  @IsOptional() @IsString() transName?: string | null;
  @IsOptional() @IsNumber() packing?: number | null;
  @IsOptional() @IsNumber() freight?: number | null;
  @IsOptional() @IsNumber() pouch?: number | null;
  @IsOptional() @IsNumber() tcs?: number | null;
  @IsOptional() @IsNumber() tds?: number | null;
  @IsOptional() @IsNumber() tdsPercent?: number | null;
  @IsOptional() @IsNumber() tax?: number | null;
  @IsOptional() @IsNumber() total?: number | null;
  @IsOptional() @IsNumber() b?: number | null;
  @IsOptional() @IsNumber() c?: number | null;
  @IsOptional() @IsString() remarks?: string | null;
  @IsOptional() @IsNumber() gst?: number | null;
  @IsOptional() @IsNumber() billingRate?: number | null;
  @IsOptional() @IsBoolean() noBill?: boolean;
  @IsOptional() @IsIn(CHALLAN_STATUSES as unknown as string[]) challanStatus?: string;

  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => CreateChallanItemDto)
  items!: CreateChallanItemDto[];
}
