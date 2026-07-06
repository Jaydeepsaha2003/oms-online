import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === 1 || value === '1';

export class BankAccountQueryDto extends PaginationDto {
  @IsOptional() @Transform(toBool) @IsBoolean() activeOnly?: boolean;
}

export class CreateBankAccountDto {
  @IsString() @MinLength(1) @MaxLength(150) bankName!: string;
  @IsString() @MinLength(1) @MaxLength(50) acNo!: string;
  @IsOptional() @IsString() @MaxLength(20) ifsc?: string;
  @IsOptional() @IsString() @MaxLength(150) branch?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
}

export class UpdateBankAccountDto extends CreateBankAccountDto {}
