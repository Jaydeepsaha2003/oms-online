import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { OpeningBalancesModule } from '../opening-balances/opening-balances.module';
import { TallyReconController } from './tally-recon.controller';
import { TallyReconService } from './tally-recon.service';

/** Quick receipt entry posts through the ordinary payments engine, and an
 *  opening added from the report through the ordinary openings service. */
@Module({
  imports: [PaymentsModule, OpeningBalancesModule],
  controllers: [TallyReconController],
  providers: [TallyReconService],
})
export class TallyReconModule {}
