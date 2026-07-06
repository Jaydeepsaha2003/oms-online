import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DR_CR } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class OpeningBalanceQueryDto extends PaginationDto {
  @IsOptional() @IsIn([...DR_CR]) drCr?: string;
}

export class CreateOpeningBalanceDto {
  @Type(() => Number) @IsInt() customerId!: number;
  @IsString() transDate!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) bankAmt?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) cashAmt?: number;
  @IsIn([...DR_CR]) drCr!: string;
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class UpdateOpeningBalanceDto extends CreateOpeningBalanceDto {}
