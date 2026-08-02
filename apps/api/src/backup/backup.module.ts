import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { AutoBackupScheduler } from './auto-backup.scheduler';

/** Whole-database export (PrismaService comes from the global PrismaModule), plus
 *  the always-current local auto-backup that runs on startup and every 5 minutes. */
@Module({
  controllers: [BackupController],
  providers: [BackupService, AutoBackupScheduler],
})
export class BackupModule {}
