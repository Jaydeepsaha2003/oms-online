import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { UserStatus } from '@oms/shared';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsIn(['active', 'disabled', 'invited'])
  status?: UserStatus;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roleIds?: string[];
}
