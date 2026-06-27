import { PartialType } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateDispatchDto {
  @IsInt()
  orderItemId!: number;

  @IsOptional() @IsNumber() bags?: number;
  @IsOptional() @IsNumber() pcs?: number;
  @IsOptional() @IsNumber() gram?: number;
  @IsOptional() @IsNumber() box?: number;

  @IsIn(['PARTIALLY DISPATCH', 'FULLY DISPATCH']) dispatchStatus!: 'PARTIALLY DISPATCH' | 'FULLY DISPATCH';

  @IsOptional() @IsString() @MaxLength(255) comment?: string;
  @IsOptional() @IsString() @MaxLength(255) supItem?: string;
  @IsOptional() @IsString() dispatchDate?: string;
}

export class UpdateDispatchDto extends PartialType(CreateDispatchDto) {}

export class DispatchQueryDto extends PaginationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() design?: string;
}

export class PendingQueryDto extends PaginationDto {
  @IsOptional() @IsString() dueType?: string;
  @IsOptional() @IsString() unit?: string;
}
