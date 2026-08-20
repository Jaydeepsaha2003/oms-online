import { IsIn, IsOptional, IsString } from 'class-validator';
import { PHOTO_GROUP_BYS, type PhotoGroupBy } from '@oms/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** `search`, `page` and `pageSize` come from PaginationDto. */
export class ProductPhotoQueryDto extends PaginationDto {
  /** Sections are pages here, so a party's photos never split across two. */
  @IsOptional() @IsIn(PHOTO_GROUP_BYS) groupBy?: PhotoGroupBy;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() designType?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}
