import { Global, Module } from '@nestjs/common';
import { ExcelService } from './excel.service';

/** Global so any feature module can inject ExcelService without importing. */
@Global()
@Module({
  providers: [ExcelService],
  exports: [ExcelService],
})
export class ExcelModule {}
