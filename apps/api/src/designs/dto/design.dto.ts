import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateDesignDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  subCategory!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  designType!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rate?: number;
}

export class UpdateDesignDto extends PartialType(CreateDesignDto) {}

export class DesignQueryDto extends PaginationDto {}

export class ImportDesignsDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
