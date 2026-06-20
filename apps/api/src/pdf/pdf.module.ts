import { Global, Module } from '@nestjs/common';
import { PdfService } from './pdf.service';

/** Global so any feature module can inject PdfService without importing. */
@Global()
@Module({
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
