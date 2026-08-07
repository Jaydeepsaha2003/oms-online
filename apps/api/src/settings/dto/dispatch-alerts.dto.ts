import { IsBoolean } from 'class-validator';

/** Every flag is required and must be a real boolean — the card always sends the
 *  complete object, so a partial body is a bug worth rejecting rather than
 *  silently merging into whatever was stored before. */
export class UpdateDispatchAlertsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  onCreate!: boolean;

  @IsBoolean()
  onBulk!: boolean;

  @IsBoolean()
  onBackdateApproved!: boolean;

  @IsBoolean()
  onEdit!: boolean;

  @IsBoolean()
  onDelete!: boolean;
}
