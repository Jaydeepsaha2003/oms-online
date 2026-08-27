import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
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

/** Several combinations in one request — see `BulkCombinationInput` in
 *  @oms/shared for why this is an endpoint rather than a loop in the browser. */
export class BulkCombinationsDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Nothing to create.' })
  @ValidateNested({ each: true })
  @Type(() => CreateCombinationDto)
  groups!: CreateCombinationDto[];
}

export class CombinationQueryDto extends PaginationDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCategory?: string;
}

export class ImportCombinationsDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
