import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCompanyDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string | null;

  /** Logo as a base64 data URL. Generous cap — the client downsizes before sending. */
  @IsOptional() @IsString() @MaxLength(4_000_000) logo?: string | null;
}
