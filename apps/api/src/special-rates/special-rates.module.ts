import { Module } from '@nestjs/common';
import { SpecialRatesController } from './special-rates.controller';
import { SpecialRatesService } from './special-rates.service';

@Module({
  controllers: [SpecialRatesController],
  providers: [SpecialRatesService],
})
export class SpecialRatesModule {}
