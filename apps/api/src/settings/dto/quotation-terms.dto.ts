import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/** Quotation bill's "Terms & Conditions" list. */
export class UpdateQuotationTermsDto {
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  terms!: string[];
}
