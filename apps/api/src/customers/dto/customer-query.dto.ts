import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CustomerQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  agentName?: string;

  @IsOptional()
  @IsString()
  category?: string;

  /** ACTIVE (default) | INACTIVE | ALL. Omitted by pickers → active-only. */
  @IsOptional()
  @IsString()
  status?: string;
}
