import { PartialType } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
}

/** Attach an already-uploaded file (from POST /files/upload) to an order line. */
export class AddOrderItemPhotoDto {
  @IsString() @MinLength(1) path!: string;
  @IsString() @MinLength(1) url!: string;
  @IsOptional() @IsString() filename?: string;
  @IsOptional() @IsString() mimeType?: string;
  @IsOptional() @IsInt() size?: number;
}

export class OrderQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;

  /** Keep orders containing this product / design on any line (exact match). */
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() design?: string;
}
