import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  customerName!: string;

  @IsOptional() @IsString() poNumber?: string;
  @IsOptional() @IsString() agentName?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() orderDate?: string;
  @IsOptional() @IsString() completionDate?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() comment?: string;

  /** Line items — fields coerced in the service. */
  @IsArray()
  items!: Record<string, unknown>[];
}

export class UpdateOrderDto extends PartialType(CreateOrderDto) {}

export class UpdateOrderStatusDto {
  @IsIn(['CONFIRMED', 'CANCELLED']) status!: 'CONFIRMED' | 'CANCELLED';
  /** Cancellation reason (from the shared Cancellation Reasons list). */
  @IsOptional() @IsString() reason?: string;
  /** Free-typed detail, used when the reason is "Others". */
  @IsOptional() @IsString() note?: string;
}

/** Attach an already-uploaded file (from POST /files/upload) to an order line. */
export class AddOrderItemPhotoDto {
  @IsString() @MinLength(1) path!: string;
  @IsString() @MinLength(1) url!: string;
  @IsOptional() @IsString() filename?: string;
  @IsOptional() @IsString() mimeType?: string;
  @IsOptional() @IsInt() size?: number;
}

/**
 * "Would this item have priced differently as of the order's own date?" —
 * Order Modify's item-change rate check. Reuses the exact same base
 * chart-rate history reconstruction as Bag Bookings' as-of-date pricing, just
 * without a frozen special-rate snapshot (a plain order never has one).
 */
export class PriceAsOfDto {
  @IsOptional() @IsInt() customerId?: number;
  @IsString() asOfDate!: string;
  @IsOptional() @IsString() @MaxLength(64) pCategory?: string;
  @IsOptional() @IsString() @MaxLength(64) subCategory?: string;
  @IsOptional() @IsString() @MaxLength(128) product?: string;
  @IsOptional() @IsString() @MaxLength(128) designType?: string;
  @IsOptional() @IsNumber() psize?: number;
}

export class OrderQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;

  /** Filter to one customer (exact match) — Order Modify's customer dropdown. */
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() agent?: string;
  /** Keep orders containing this product / design on any line (exact match). */
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() design?: string;
  /** Exact match on the order's numeric id (Order Modify's Order ID picker). */
  @IsOptional() @Transform(({ value }) => (value === '' || value == null ? undefined : parseInt(value, 10))) @IsInt() orderId?: number;
  /** Line priority filter — 'URGENT' / 'NORMAL' (Order Modify's Priority dropdown;
   *  not applied by the main list, only by the export endpoint). */
  @IsOptional() @IsString() priority?: string;
  /** Excel export only: comma-separated column ids (see ORDER_LINE_EXPORT_COLUMNS). */
  @IsOptional() @IsString() columns?: string;
}
