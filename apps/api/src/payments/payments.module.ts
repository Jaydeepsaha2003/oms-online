import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService],
  // Tally reconciliation posts its quick receipts through this same engine.
  exports: [PaymentsService],
})
export class PaymentsModule {}
