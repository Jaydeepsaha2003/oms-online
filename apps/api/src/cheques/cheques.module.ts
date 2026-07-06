import { Module } from '@nestjs/common';
import { ChequesController } from './cheques.controller';
import { ChequesService } from './cheques.service';

@Module({
  controllers: [ChequesController],
  providers: [ChequesService],
})
export class ChequesModule {}
