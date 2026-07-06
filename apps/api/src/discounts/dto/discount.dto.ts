import { IsIn, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { DISCOUNT_MODES } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class DiscountInvoiceQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  /** BANK | CASH — only rows with a positive balance on that side. */
  @IsOptional() @IsString() mode?: string;
  @IsOptional() @IsString() search?: string;
}

export class DiscountHistoryQueryDto extends PaginationDto {
  @IsString() invNo!: string;
}

export class SaveDiscountDto {
  @IsString() invNo!: string;
  @Type(() => Number) @IsInt() customerId!: number;
  @IsIn(DISCOUNT_MODES as unknown as string[]) billType!: string;
  @Type(() => Number) @IsNumber() disAmt!: number;
  @IsString() disDate!: string;
}
