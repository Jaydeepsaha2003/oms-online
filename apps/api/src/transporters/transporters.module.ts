import { Module } from '@nestjs/common';
import { TransportersController } from './transporters.controller';
import { TransportersService } from './transporters.service';

@Module({
  controllers: [TransportersController],
  providers: [TransportersService],
  exports: [TransportersService],
})
export class TransportersModule {}
