import { ArrayNotEmpty, IsArray, IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
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

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits.' })
  pin?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roleIds!: string[];

  @IsOptional()
  @IsIn(['active', 'disabled', 'invited'])
  status?: UserStatus;
}
