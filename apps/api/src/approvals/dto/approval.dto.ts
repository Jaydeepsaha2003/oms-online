import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { APPROVAL_STATUSES } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ApprovalQueryDto extends PaginationDto {
  @IsOptional() @IsIn([...APPROVAL_STATUSES, 'ALL']) status?: string;
  @IsOptional() @IsString() type?: string;
  // `search` already exists on PaginationDto — reuse it rather than shadow it.
}

export class ApprovalDecisionDto {
  /** Optional when approving; required when rejecting (enforced in the service). */
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
