import { IsBoolean } from 'class-validator';

/** Which optional fields the Challan form shows. */
export class UpdateChallanFieldsDto {
  @IsBoolean() showShippingAddress!: boolean;
}
