import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOrderOptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  group!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value!: string;
}
