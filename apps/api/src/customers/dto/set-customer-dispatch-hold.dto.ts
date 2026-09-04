import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Place or release a party's dispatch hold.
 *
 * A narrow DTO for the same reason {@link SetCustomerActiveDto} is narrow:
 * `UpdateCustomerDto` looks partial but is applied as a full overwrite, so a
 * one-purpose action gets a contract that cannot carry anything else along.
 *
 * `reason` is only meaningful when placing a hold. Releasing one clears it —
 * see CustomersService.setDispatchHold — rather than leaving last month's
 * reason attached to a party that is shipping again.
 */
export class SetCustomerDispatchHoldDto {
  @IsBoolean() hold!: boolean;
  /** Capped so it stays readable in a toast and on a dispatch card. */
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** The same action across a ticked set of parties, in one write. */
export class BulkSetCustomerDispatchHoldDto {
  @IsArray() @ArrayNotEmpty() @Type(() => Number) @IsInt({ each: true }) ids!: number[];
  @IsBoolean() hold!: boolean;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
