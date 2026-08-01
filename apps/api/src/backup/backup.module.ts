import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

/** Whole-database export (PrismaService comes from the global PrismaModule). */
@Module({
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
