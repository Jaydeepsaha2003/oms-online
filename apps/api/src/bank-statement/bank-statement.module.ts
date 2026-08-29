import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { BankStatementController } from './bank-statement.controller';
import { BankStatementService } from './bank-statement.service';

/** Process posts through the ordinary payments engine, so there is only ever
 *  one allocation path for a receipt however it was entered. */
@Module({
  imports: [PaymentsModule],
  controllers: [BankStatementController],
  providers: [BankStatementService],
})
export class BankStatementModule {}
