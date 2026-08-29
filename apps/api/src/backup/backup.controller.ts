import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { BackupService } from './backup.service';

const SQLITE_MIME = 'application/vnd.sqlite3';
/** A whole database, so the cap is generous — but not unbounded. */
const MAX_RESTORE_BYTES = 512 * 1024 * 1024;

@ApiTags('Backup')
@ApiBearerAuth()
@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get('database')
  @Permissions(perm(RESOURCES.BACKUP, ACTIONS.EXPORT))
  @Audit({
    action: ACTIONS.EXPORT,
    resource: RESOURCES.BACKUP,
    description: 'Downloaded a full database backup',
  })
  @ApiOperation({
    summary: 'Download the whole database as a SQLite file',
    description:
      'Returns a consistent point-in-time snapshot of the entire database (every table and row). ' +
      'Restore it by stopping the API and replacing apps/api/prisma/dev.db with this file.',
  })
  async database(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { stream, filename, size } = await this.backup.createBackup();
    res.set({
      'Content-Type': SQLITE_MIME,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(size),
    });
    return new StreamableFile(stream);
  }

  /**
   * Replace the live database with an uploaded backup.
   *
   * Held in memory rather than written straight to disk: the service vets the
   * bytes (SQLite header, integrity, core tables, matching migrations) before
   * anything on disk is touched, and the database being replaced is kept.
   *
   * `backup:import` is its own permission and nobody holds it unless it has
   * been granted — this is the one action in the app that discards everything.
   */
  @Post('restore')
  @Permissions(perm(RESOURCES.BACKUP, ACTIONS.IMPORT))
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_RESTORE_BYTES } }),
  )
  @Audit({
    action: ACTIONS.IMPORT,
    resource: RESOURCES.BACKUP,
    description: 'Restored the database from a backup file',
  })
  @ApiOperation({
    summary: 'Restore the whole database from a backup file',
    description:
      'Replaces every row in the live database with the contents of the uploaded SQLite backup. ' +
      'The database being replaced is snapshotted to backups/pre-restore-<date>.db first, and the ' +
      'file itself is kept alongside as dev.db.replaced-<date>.',
  })
  restore(
    @UploadedFile() file: Express.Multer.File | undefined,
    // Multipart text fields arrive as strings, so compare rather than trust.
    @Body('allowNewer') allowNewer?: string,
  ) {
    if (!file) throw new BadRequestException('Choose a backup (.db) file to restore.');
    return this.backup.restoreFrom(file.buffer, file.originalname, allowNewer === 'true');
  }
}
