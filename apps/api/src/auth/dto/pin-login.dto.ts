import { IsEmail, IsString, Matches } from 'class-validator';

export class PinLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits.' })
  pin!: string;
}
