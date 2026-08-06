import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

@Module({
  controllers: [DispatchController],
  providers: [DispatchService],
  // Design Track reads the same pending pool (DispatchService.pendingPool).
  exports: [DispatchService],
})
export class DispatchModule {}
