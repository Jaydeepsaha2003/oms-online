import { Transform, Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class DesignTrackQueryDto extends PaginationDto {
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() design?: string;
}

export class SetKalwatDto {
  /**
   * Processed quantity, or null to clear the entry back to "not started".
   * `ValidateIf` lets an explicit null through while still rejecting rubbish —
   * `@IsOptional()` alone would also skip validation for a missing field, and
   * clearing has to be a deliberate null rather than an omission.
   */
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @Transform(({ value }) => (value === '' || value === undefined ? null : value), { toClassOnly: true })
  @IsNumber()
  @Min(0)
  kalwat!: number | null;
}
