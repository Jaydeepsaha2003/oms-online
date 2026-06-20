import { Module } from '@nestjs/common';
import { TransRatesController } from './trans-rates.controller';
import { TransRatesService } from './trans-rates.service';

@Module({
  controllers: [TransRatesController],
  providers: [TransRatesService],
  exports: [TransRatesService],
})
export class TransRatesModule {}
