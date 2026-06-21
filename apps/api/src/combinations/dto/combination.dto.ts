import { PartialType } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateCombinationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  designIds!: number[];
}

export class UpdateCombinationDto extends PartialType(CreateCombinationDto) {}

export class CombinationQueryDto extends PaginationDto {}

export class ImportCombinationsDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
