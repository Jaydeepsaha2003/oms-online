import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
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

  /** GSTIN or TRANSIN (15 characters), or empty to clear. */
  @IsOptional()
  @IsString()
  @Matches(/^([0-9A-Za-z]{15})?$/, { message: 'Transporter GSTIN / ID must be 15 letters and digits.' })
  gstin?: string;
}

export class UpdateTransporterDto extends PartialType(CreateTransporterDto) {}

export class TransporterQueryDto extends PaginationDto {}

export class ImportTransportersDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
