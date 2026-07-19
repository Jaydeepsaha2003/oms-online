import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/** Sales Order / Quotation bill's footer text lines. */
export class UpdateOrderFooterDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  lines!: string[];
}
