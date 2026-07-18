import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { UploadedFileDto } from '@oms/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  DESIGN_NAME_PHOTOS_SUBDIR,
  ORDER_ITEM_PHOTOS_SUBDIR,
  UPLOADS_URL_PREFIX,
  ensureUploadDir,
} from './uploads.constants';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per image

// Allow-listed destination folders, keyed by the `folder` query param the
// caller passes — never derived from free-form client input (path traversal).
const FOLDERS: Record<string, string> = {
  'order-items': ORDER_ITEM_PHOTOS_SUBDIR,
  'design-names': DESIGN_NAME_PHOTOS_SUBDIR,
};

/**
 * Identify the real image format from its magic bytes. The client-supplied
 * Content-Type header and filename extension are both attacker-controlled and
 * trivially spoofed — trusting either is how "upload an .html file declared as
 * image/png" stored-XSS attacks work, since /uploads is served statically
 * (unauthenticated, Content-Type inferred from the stored extension). Returns
 * the extension to store the file under, or null when the bytes aren't a
 * recognised image — never derived from client input.
 */
function sniffImageExt(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.toString('ascii', 0, 6))) return '.gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (buf.length >= 2 && buf.toString('ascii', 0, 2) === 'BM') return '.bmp';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return '.heic';
  }
  return null;
}

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
      // Buffered in memory (capped by `limits.fileSize`) so the real bytes are
      // available to sniff before anything touches disk — diskStorage's
      // fileFilter only ever sees the (spoofable) declared mimetype/filename,
      // not the content.
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('folder') folder?: string,
  ): UploadedFileDto {
    if (!file) throw new BadRequestException('No file was uploaded.');
    const ext = sniffImageExt(file.buffer);
    if (!ext) throw new BadRequestException('Only image files are allowed.');

    const subdir = (folder && FOLDERS[folder]) || ORDER_ITEM_PHOTOS_SUBDIR;
    const filename = `${randomUUID()}${ext}`;
    writeFileSync(join(ensureUploadDir(subdir), filename), file.buffer);

    const path = `${subdir}/${filename}`;
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
