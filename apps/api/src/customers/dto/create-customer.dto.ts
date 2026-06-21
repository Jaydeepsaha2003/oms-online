import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PARTY_SOURCES, PAY_BYS } from '@oms/shared';
import { EMAIL_REGEX, MOBILE_REGEX } from '../../common/validation';

/** Treat empty strings as "not provided" for optional enum fields. */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class CreateCustomerDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn([...PARTY_SOURCES])
  partySource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  agentName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  partyName!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  billingRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  transportName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  bagName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  packing?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  freight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  boxRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  creditPeriod?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  region?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(20)
  @Matches(MOBILE_REGEX, {
    message: 'Mobile must be a valid number (7–19 digits, optional + - ( ) and spaces).',
  })
  mobile?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(255)
  @Matches(EMAIL_REGEX, { message: 'Enter a valid email address.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  brand?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  billRatePc?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn([...PAY_BYS])
  payBy?: string;
}
