import { PartialType } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

  /** Path from POST /files/upload?folder=design-names. Omit/null for no photo. */
  @IsOptional()
  @IsString()
  photoPath?: string | null;

  @IsOptional()
  @IsString()
  photoUrl?: string | null;
}

export class UpdateDesignNameDto extends PartialType(CreateDesignNameDto) {}

export class DesignNameQueryDto extends PaginationDto {}

export class ImportDesignNamesDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
