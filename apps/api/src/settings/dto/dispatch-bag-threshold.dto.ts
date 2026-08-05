import { IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';

/** Global fallback bag threshold — null clears it (no default limit). */
export class UpdateDispatchBagThresholdDto {
  @ValidateIf((o) => o.maxBagsPerDispatch !== null)
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  maxBagsPerDispatch!: number | null;
}
