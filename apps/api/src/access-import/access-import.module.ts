import { Module } from '@nestjs/common';
import { AccessImportController } from './access-import.controller';
import { AccessImportService } from './access-import.service';

/** MS Access → OMS data connector (Settings → Data Import). Access stays a live parallel data source. */
@Module({
  controllers: [AccessImportController],
  providers: [AccessImportService],
})
export class AccessImportModule {}
