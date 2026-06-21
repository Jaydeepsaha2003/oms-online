import { Module } from '@nestjs/common';
import { CombinationsController } from './combinations.controller';
import { CombinationsService } from './combinations.service';

@Module({
  controllers: [CombinationsController],
  providers: [CombinationsService],
  exports: [CombinationsService],
})
export class CombinationsModule {}
