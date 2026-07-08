import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import type { UploadedFileDto } from '@oms/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  ORDER_ITEM_PHOTOS_SUBDIR,
  UPLOADS_URL_PREFIX,
  ensureUploadDir,
} from './uploads.constants';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per image
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

/**
 * File uploads. Currently just order-line photos: the file is written to the
 * project's /uploads folder and this returns the stored path + served URL, which
 * the caller then attaches to an order line (on save, or directly via the
 * order-photo endpoints). Authenticated (global JwtAuthGuard); no extra
 * permission so it's reachable from the order create/modify/dispatch flows alike.
 */
@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('files')
export class UploadsController {
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, ensureUploadDir(ORDER_ITEM_PHOTOS_SUBDIR)),
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: MAX_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (IMAGE_MIME.test(file.mimetype)) return cb(null, true);
        cb(new BadRequestException('Only image files are allowed.'), false);
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): UploadedFileDto {
    if (!file) throw new BadRequestException('No file was uploaded.');
    const path = `${ORDER_ITEM_PHOTOS_SUBDIR}/${file.filename}`;
    return {
      path,
      url: `${UPLOADS_URL_PREFIX}/${path}`,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadedBy: user?.email ?? null,
    };
  }
}
