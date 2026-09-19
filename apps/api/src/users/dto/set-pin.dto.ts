import { IsOptional, Matches } from 'class-validator';

/**
 * DTO for setting or clearing a user's quick login PIN.
 * Pass a 4-digit numeric PIN to set, or null/empty to clear.
 */
export class SetUserPinDto {
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits.' })
  pin?: string | null;
}
