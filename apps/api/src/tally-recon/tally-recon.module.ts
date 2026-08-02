import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { TallyReconController } from './tally-recon.controller';
import { TallyReconService } from './tally-recon.service';

/** Quick receipt entry posts through the ordinary payments engine. */
@Module({
  imports: [PaymentsModule],
  controllers: [TallyReconController],
  providers: [TallyReconService],
})
export class TallyReconModule {}
