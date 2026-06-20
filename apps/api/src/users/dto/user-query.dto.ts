import { IsIn, IsOptional } from 'class-validator';
import type { UserStatus } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class UserQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['active', 'disabled', 'invited'])
  status?: UserStatus;
}
