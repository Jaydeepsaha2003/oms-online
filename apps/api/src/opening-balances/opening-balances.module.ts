import { Module } from '@nestjs/common';
import { OpeningBalancesController } from './opening-balances.controller';
import { OpeningBalancesService } from './opening-balances.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // PaymentsModule → a changed opening re-settles the party's receipts.
  imports: [PaymentsModule],
  controllers: [OpeningBalancesController],
  providers: [OpeningBalancesService],
  // Tally Reconciliation adds openings through this same service, so an opening
  // made from the report is stored exactly like one keyed in here.
  exports: [OpeningBalancesService],
})
export class OpeningBalancesModule {}
