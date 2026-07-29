import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

/** Shared query filters for every report endpoint. All optional. */
export class ReportFilterDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value))) @IsInt() customerId?: number;
  @IsOptional() @IsString() agent?: string;
  @IsOptional() @IsString() region?: string;
}
