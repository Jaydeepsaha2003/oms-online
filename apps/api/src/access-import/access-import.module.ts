import { Module } from '@nestjs/common';
import { AccessImportController } from './access-import.controller';
import { AccessImportService } from './access-import.service';

/** TEMPORARY module — MS Access → OMS data connector (Settings → Data Import). */
@Module({
  controllers: [AccessImportController],
  providers: [AccessImportService],
})
export class AccessImportModule {}
