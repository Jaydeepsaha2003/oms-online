import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateTransporterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  packing?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  freight?: number;
}

export class UpdateTransporterDto extends PartialType(CreateTransporterDto) {}

export class TransporterQueryDto extends PaginationDto {}

export class ImportTransportersDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
