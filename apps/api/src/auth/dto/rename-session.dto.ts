import { IsOptional, IsString, MaxLength } from 'class-validator';

/** The name someone gives their own device in My Devices. */
export class RenameSessionDto {
  /** Blank or omitted clears it, putting the derived "Chrome on Android" back. */
  @IsOptional() @IsString() @MaxLength(60) name?: string | null;
}
