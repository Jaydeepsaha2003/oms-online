import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/** Challan / Tax Invoice bill's "Terms & Conditions" list. */
export class UpdateChallanTermsDto {
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  terms!: string[];
}
