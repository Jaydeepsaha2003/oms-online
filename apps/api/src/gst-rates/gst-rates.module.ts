import { Module } from '@nestjs/common';
import { GstRatesController } from './gst-rates.controller';
import { GstRatesService } from './gst-rates.service';

@Module({
  controllers: [GstRatesController],
  providers: [GstRatesService],
  exports: [GstRatesService],
})
export class GstRatesModule {}
