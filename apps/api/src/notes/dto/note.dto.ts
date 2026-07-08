import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { NOTE_MODES } from '@oms/shared';

export class RecentSoldQueryDto {
  @Type(() => Number) @IsInt() customerId!: number;
}

export class NextNoteQueryDto {
  @IsIn(NOTE_MODES as unknown as string[]) mode!: string;
}

export class NoteDirectoryQueryDto {
  @IsIn(NOTE_MODES as unknown as string[]) mode!: string;
  @IsOptional() @IsString() fromDate?: string;
  @IsOptional() @IsString() toDate?: string;
  @IsOptional() @IsString() payMode?: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() search?: string;
}

export class NoteItemDto {
  @IsOptional() @Type(() => Number) @IsInt() dispatchId?: number;
  @IsOptional() @IsString() refInvNo?: string;
  @IsString() productName!: string;
  @IsOptional() @IsString() design?: string;
  @IsOptional() @Type(() => Number) @IsNumber() bags?: number;
  @IsOptional() @Type(() => Number) @IsNumber() pcs?: number;
  @IsOptional() @Type(() => Number) @IsNumber() kgs?: number;
  @IsOptional() @Type(() => Number) @IsNumber() box?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @Type(() => Number) @IsNumber() price?: number;
  @IsOptional() @Type(() => Number) @IsNumber() gstRate?: number;
  @IsOptional() @IsString() pCategory?: string;
  @IsOptional() @IsString() comment?: string;
}

export class SaveNoteDto {
  @IsIn(NOTE_MODES as unknown as string[]) mode!: string;
  /** Voucher no on edit; omit on create to auto-number. */
  @IsOptional() @IsString() code?: string;
  @IsString() invDate!: string;
  @Type(() => Number) @IsInt() customerId!: number;
  @IsString() customerName!: string;
  @IsOptional() @IsString() billingAddress?: string;
  @IsOptional() @IsString() shippingAddress?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @Type(() => Number) @IsInt() paymentTerm?: number;
  @IsOptional() @IsString() transName?: string;
  @IsOptional() @Type(() => Number) @IsNumber() packing?: number;
  @IsOptional() @Type(() => Number) @IsNumber() freight?: number;
  @IsOptional() @Type(() => Number) @IsNumber() pouch?: number;
  @IsOptional() @Type(() => Number) @IsNumber() tcs?: number;
  @IsOptional() @Type(() => Number) @IsNumber() gst?: number;
  @IsOptional() @Type(() => Number) @IsNumber() freightRate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() packingRate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() billingRate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() bpcRate?: number;
  /** Manual GST override; omit for auto. */
  @IsOptional() @Type(() => Number) @IsNumber() manualTax?: number;
  @IsOptional() @IsString() remarks?: string;
  @IsOptional() @IsBoolean() noBill?: boolean;
  @IsOptional() @IsBoolean() noBillWithoutGst?: boolean;
  @IsOptional() @IsString() challanStatus?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => NoteItemDto) items!: NoteItemDto[];
}
