import { PartialType } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { QUOTATION_STATUSES } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateQuotationDto {
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
  /** A quotation's own status vocabulary — never an ORDER_STATUSES value
   *  (e.g. "CONFIRMED" means nothing on a quotation and must be rejected). */
  @IsOptional() @IsIn(QUOTATION_STATUSES) status?: string;
  @IsOptional() @IsString() comment?: string;

  /** Line items — fields coerced in the service. */
  @IsArray()
  items!: Record<string, unknown>[];
}

export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {}

export class CancelQuotationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason!: string;

  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ConvertQuotationDto {
  /** 'DIRECT' or 'EDITED' — how the quotation reached conversion. */
  @IsOptional() @IsIn(['DIRECT', 'EDITED']) mode?: 'DIRECT' | 'EDITED';
}

export class QuotationQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;
}
