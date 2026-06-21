import { PartialType } from '@nestjs/swagger';
import { IsArray, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateDesignNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  designType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  designName!: string;
}

export class UpdateDesignNameDto extends PartialType(CreateDesignNameDto) {}

export class DesignNameQueryDto extends PaginationDto {}

export class ImportDesignNamesDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
