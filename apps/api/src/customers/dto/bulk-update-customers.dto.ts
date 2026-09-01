import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { PARTY_SOURCES, PAY_BYS } from '@oms/shared';

/**
 * The dropdown-backed columns a bulk edit may set, and nothing else.
 *
 * Narrow on purpose, for the reason SetCustomerActiveDto spells out:
 * `UpdateCustomerDto` looks partial but is applied as a full overwrite, so an
 * action that writes a few columns across many rows gets a contract that cannot
 * carry anything else along with it. Free-text and money columns (billingRate,
 * packing, freight, boxRate, creditPeriod, mobile, email, TDS) are deliberately
 * absent — as is `transporterId`, because setting a transporter also rewrites
 * packing and freight (see CustomersService.resolveTransporter), which is a
 * freight-cost change wearing a dropdown's clothes.
 *
 * Every field is optional; only the ones actually present are written.
 */
export class BulkCustomerValuesDto {
  @IsOptional() @IsString() @IsIn([...PARTY_SOURCES]) partySource?: string;
  @IsOptional() @IsString() @IsIn([...PAY_BYS]) payBy?: string;
  @IsOptional() @IsString() agentName?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() region?: string;
}

/**
 * Which customers to change, and what to set on them.
 *
 * Always explicit ids, never a filter: "apply to all N matching" is turned into
 * ids by the page before it gets here. One code path, and preview and apply
 * name the same rows — so what the dialog showed cannot drift from what is
 * written. `ArrayNotEmpty` is the guard that matters; an empty target must be a
 * 400, never a silent no-op that reads as success.
 */
export class BulkUpdateCustomersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  ids!: number[];

  @ValidateNested()
  @Type(() => BulkCustomerValuesDto)
  set!: BulkCustomerValuesDto;
}
