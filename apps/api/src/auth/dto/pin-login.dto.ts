import { IsEmail, IsString, Matches } from 'class-validator';

export class PinLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4 to 6 digits.' })
  pin!: string;
}
