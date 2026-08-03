import { IsNumber, Max, Min } from 'class-validator';

/** Global TCS % applied to SCRAP-category challans. */
export class UpdateTcsSettingDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  tcsPercent!: number;
}
