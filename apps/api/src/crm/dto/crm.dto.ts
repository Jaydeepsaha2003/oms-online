import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateFollowupDto {
  @IsOptional() @IsIn(['DELIVERY', 'PAYMENT']) kind?: 'DELIVERY' | 'PAYMENT';
  @IsOptional() @IsInt() customerId?: number | null;
  @IsString() @MaxLength(255) partyName!: string;
  @IsOptional() @IsInt() orderId?: number | null;
  @IsOptional() @IsString() @MaxLength(64) orderCode?: string | null;
  @IsOptional() @IsInt() orderItemId?: number | null;
  @IsOptional() @IsString() @MaxLength(500) itemText?: string | null;
  @IsString() @MaxLength(255) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) detail?: string | null;
  @IsOptional() @IsString() @MaxLength(64) stage?: string | null;
  @IsOptional() @IsIn(['NORMAL', 'URGENT']) priority?: 'NORMAL' | 'URGENT';
  @IsOptional() @IsString() promisedAt?: string | null;
  @IsOptional() @IsInt() @Min(1) reminderIntervalMins?: number | null;
  @IsOptional() @IsInt() @Min(0) maxRemindersPerDay?: number | null;
}

export class UpdateFollowupDto extends PartialType(CreateFollowupDto) {}

export class AddFollowupLogDto {
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @IsString() @MaxLength(64) stage?: string | null;
  @IsOptional() @IsString() newPromisedAt?: string | null;
}

export class FollowupQueryDto extends PaginationDto {
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() party?: string;
  @IsOptional() @IsString() bucket?: string;
}

export class CrmSettingsDto {
  @IsOptional() @IsInt() @Min(1) intervalMins?: number;
  @IsOptional() @IsInt() @Min(0) maxRemindersPerDay?: number;
  @IsOptional() @IsInt() @Min(0) leadDays?: number;
  @IsOptional() @IsInt() @Min(0) workStartHour?: number;
  @IsOptional() @IsInt() @Min(0) workEndHour?: number;
  @IsOptional() @IsBoolean() sound?: boolean;
  @IsOptional() @IsBoolean() desktopNotifications?: boolean;
}
