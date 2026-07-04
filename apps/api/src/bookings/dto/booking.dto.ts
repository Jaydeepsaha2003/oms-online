import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateBookingDto {
  @IsString() @MaxLength(255) customerName!: string;
  @IsOptional() @IsString() @MaxLength(255) agentName?: string | null;
  @IsOptional() @IsString() @MaxLength(64) category?: string | null;
  @IsOptional() @IsString() bookingDate?: string | null;
  @IsNumber() @Min(0) bags!: number;
  @IsNumber() @Min(0) kgs!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string | null;
}

export class UpdateBookingDto extends PartialType(CreateBookingDto) {}

export class ConvertBookingLineDto {
  @IsOptional() @IsString() @MaxLength(64) pCategory?: string | null;
  @IsOptional() @IsString() @MaxLength(64) subCategory?: string | null;
  @IsOptional() @IsString() @MaxLength(128) product?: string | null;
  @IsOptional() @IsString() @MaxLength(128) design?: string | null;
  @IsOptional() @IsString() @MaxLength(255) productName?: string | null;
  @IsOptional() @IsString() @MaxLength(128) designType?: string | null;
  @IsOptional() @IsNumber() psize?: number | null;
  @IsOptional() @IsNumber() bags?: number | null;
  @IsOptional() @IsNumber() pcs?: number | null;
  @IsOptional() @IsNumber() gram?: number | null;
  @IsOptional() @IsNumber() box?: number | null;
  @IsOptional() @IsString() @MaxLength(16) calField?: string | null;
  @IsOptional() @IsString() @MaxLength(500) comment?: string | null;
}

export class ConvertBookingDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ConvertBookingLineDto)
  lines!: ConvertBookingLineDto[];
}

export class BookingQueryDto extends PaginationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() customer?: string;
}

export class PriceHistoryQueryDto extends PaginationDto {
  @IsOptional() @IsIn(['PRODUCT', 'DESIGN', 'CUSTOMER']) kind?: 'PRODUCT' | 'DESIGN' | 'CUSTOMER';
}
