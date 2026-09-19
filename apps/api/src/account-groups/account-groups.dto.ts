import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { GROUP_ALLOC_METHODS } from '@oms/shared';

export class CreateAccountGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  alias?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  parentId?: number | null;

  @IsOptional()
  @IsBoolean()
  isSubLedger?: boolean;

  @IsOptional()
  @IsBoolean()
  nettBalances?: boolean;

  @IsOptional()
  @IsBoolean()
  usedForCalc?: boolean;

  @IsOptional()
  @IsIn([...GROUP_ALLOC_METHODS])
  allocMethod?: string;
}

export class UpdateAccountGroupDto extends PartialType(CreateAccountGroupDto) {}

export class MoveLedgersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  customerIds!: number[];

  @Type(() => Number)
  @IsInt()
  groupId!: number;
}

class TallyImportGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  parent!: string | null;
}

class TallyImportPartyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  tallyName!: string;

  @Type(() => Number)
  @IsInt()
  customerId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  groupName!: string;
}

class TallyImportOtherDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  tallyName!: string;

  @IsIn(['AGENT', 'EXPENSE', 'OTHER'])
  filing!: 'AGENT' | 'EXPENSE' | 'OTHER';
}

export class TallyImportApplyDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TallyImportGroupDto)
  groups!: TallyImportGroupDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TallyImportPartyDto)
  parties!: TallyImportPartyDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TallyImportOtherDto)
  others!: TallyImportOtherDto[];
}
