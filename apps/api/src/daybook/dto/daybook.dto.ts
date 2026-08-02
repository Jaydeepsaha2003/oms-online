import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class DaybookQueryDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsOptional() @IsString() voucherType?: string;
  @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
}
