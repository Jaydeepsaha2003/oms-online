import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateDispatchDto {
  @IsInt()
  orderItemId!: number;

  @IsOptional() @IsNumber() @Min(0) bags?: number;
  @IsOptional() @IsNumber() @Min(0) pcs?: number;
  @IsOptional() @IsNumber() @Min(0) gram?: number;
  @IsOptional() @IsNumber() @Min(0) box?: number;

  @IsIn(['PARTIALLY DISPATCH', 'FULLY DISPATCH']) dispatchStatus!: 'PARTIALLY DISPATCH' | 'FULLY DISPATCH';

  @IsOptional() @IsString() @MaxLength(255) comment?: string;
  @IsOptional() @IsString() @MaxLength(255) supItem?: string;
  @IsOptional() @IsString() dispatchDate?: string;

  /**
   * Withdraw this dispatch's EXTRA qty from this bag booking.
   *
   * Set only when the operator answered yes to "dispatching more than the line
   * has pending — take the extra off booking X?". The extra itself is NOT sent:
   * the server works it out from the line's own remaining, so a stale or
   * tampered client can't decide how much comes off a booking.
   */
  @IsOptional() @IsInt() bookingDrawId?: number;

  /**
   * The user saw the "similar dispatch today" warning and chose to go ahead.
   *
   * Only lifts the PARTIAL check. An exact same-day collision is refused
   * whatever this says — there is no legitimate reading of the same line, same
   * day, same every quantity other than the same shipment entered twice.
   */
  @IsOptional() @IsBoolean() confirmSimilar?: boolean;

  /** An approver confirmed closing the line as Fully Dispatched although it is
   *  a whole bag or more short (the party cancelled the rest). Ignored for anyone else. */
  @IsOptional() @IsBoolean() confirmShortFull?: boolean;
}

export class UpdateDispatchDto extends PartialType(CreateDispatchDto) {}

export class DispatchQueryDto extends PaginationDto {
  // Declared or `ValidationPipe({ whitelist: true })` strips it and the
  // dropdown silently filters nothing.
  @IsOptional() @IsString() category?: string;

  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() agent?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() design?: string;
  /** Off (default) → `product` is a BASE item name and also matches its design
   *  variants, because Modify Dispatch's picker lists base names. On → the exact
   *  item only. Same meaning as on {@link PendingQueryDto}. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() all?: boolean;
  /** Dispatch-date range (inclusive), 'YYYY-MM-DD' — Modify Dispatch's Date filter
   *  and the Group-by-Date-&-Party view. */
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  /** Order number, as shown in the ORD# column — an exact order id. Matched on
   *  the id rather than `orderCode LIKE`, so typing 903 cannot also drag in
   *  ORD-9031; the column shows the id with its ORD- prefix stripped, so what
   *  the user reads off the row is exactly what they type here. */
  @IsOptional() @Type(() => Number) @IsInt() orderId?: number;
  /** Several order ids at once, comma-separated ("1132,1330") — Modify
   *  Dispatch's multi-pick of the ORD# filter. */
  @IsOptional() @IsString() orderIds?: string;
  /** Only Full rows whose order line is still a whole bag or more short. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() shortFull?: boolean;
  /** Excel export: which columns, comma-separated ids (all when empty). */
  @IsOptional() @IsString() columns?: string;
}

export class PendingQueryDto extends PaginationDto {
  @IsOptional() @IsString() dueType?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() agent?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() design?: string;
  /** Product category — matched against the line's `pCategory`. */
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCategory?: string;
  /** "ALL" toggle → product matched as a base name (all design variants). */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() all?: boolean;
  /** Excel export only: comma-separated column ids (see DISPATCH_EXPORT_COLUMNS). */
  @IsOptional() @IsString() columns?: string;
}

/** The Dispatch Order screen's bulk row-selection action: mark a batch of still-
 *  pending lines URGENT (or back to NORMAL) in one call instead of opening each
 *  line's own edit form. Capped at 500 — comfortably above a real selection
 *  (the whole pending pool rarely runs that deep on one page), but a bound
 *  rather than an unlimited `updateMany` on whatever a client sends. */
export class BulkSetPendingPriorityDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  orderItemIds!: number[];

  @IsIn(['URGENT', 'NORMAL'])
  priority!: 'URGENT' | 'NORMAL';
}

/** One cup item going out against a booking — entered in boxes only. */
export class BookingDispatchLineDto {
  @IsString() @MaxLength(64) subCategory!: string;
  @IsString() @MaxLength(255) product!: string;
  /** Boxes and/or pcs (pcs wins). Kgs and bags are derived server-side from the
   *  product master and the party's bag weight, so the client cannot decide the draw-down. */
  @IsOptional() @IsNumber() @Min(0) box?: number | null;
  @IsOptional() @IsNumber() @Min(0) pcs?: number | null;
  @IsOptional() @IsNumber() @Min(0) gram?: number | null;
  @IsOptional() @IsString() @MaxLength(128) designType?: string | null;
  @IsOptional() @IsString() @MaxLength(128) design?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20)
  photos?: { path?: string; url?: string; filename?: string | null; mimeType?: string | null; size?: number | null }[];
  @IsOptional() @IsString() @MaxLength(255) comment?: string | null;
}

export class DispatchFromBookingDto {
  @IsInt() bookingId!: number;
  @IsOptional() @IsString() dispatchDate?: string | null;
  /** Bags the whole dispatch went in — drawn off the booking. */
  @IsNumber() @Min(0.001) bags!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BookingDispatchLineDto)
  lines!: BookingDispatchLineDto[];
}
