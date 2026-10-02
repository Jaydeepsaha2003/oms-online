import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PendingProcessorController } from './pending-processor.controller';
import { PendingProcessorService } from './pending-processor.service';

@Module({
  // DispatchModule → the shared pending-line pool (the old PendOrder table).
  imports: [DispatchModule],
  controllers: [PendingProcessorController],
  providers: [PendingProcessorService],
})
export class PendingProcessorModule {}
