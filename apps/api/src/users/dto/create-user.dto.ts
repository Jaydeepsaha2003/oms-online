import { ArrayNotEmpty, IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { UserStatus } from '@oms/shared';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roleIds!: string[];

  @IsOptional()
  @IsIn(['active', 'disabled', 'invited'])
  status?: UserStatus;
}
