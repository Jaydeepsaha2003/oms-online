import { IsArray, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateRoleDto {
  /** Machine name: lowercase letters, digits and underscores. */
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'name must be lowercase letters, digits and underscores (e.g. "warehouse_clerk")',
  })
  name!: string;

  @IsString()
  @MinLength(2)
  label!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}
