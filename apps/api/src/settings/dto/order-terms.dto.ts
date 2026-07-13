import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/** Sales Order / Quotation bill's "Terms & Conditions" list. */
export class UpdateOrderTermsDto {
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  terms!: string[];
}
