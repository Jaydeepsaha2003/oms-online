import { PartialType } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}

export class UpdateAgentDto extends PartialType(CreateAgentDto) {}

export class AgentQueryDto extends PaginationDto {}

export class ImportAgentsDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
