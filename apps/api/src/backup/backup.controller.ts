import { Controller, Get, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { BackupService } from './backup.service';

const SQLITE_MIME = 'application/vnd.sqlite3';

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
}
