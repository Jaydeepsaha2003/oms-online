import { PartialType } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

export class OrderQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;
}
