import { IsString, MinLength } from 'class-validator';

/** An administrator setting another user's password (a forgotten-password reset).
 *  There is deliberately no "current password" field — the whole point is that
 *  nobody, including the admin, can know the existing one: it is stored only as
 *  a one-way bcrypt hash. */
export class SetUserPasswordDto {
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password!: string;
}
