import { Module } from '@nestjs/common';
import { PartyLedgerController } from './party-ledger.controller';
import { PartyLedgerService } from './party-ledger.service';

@Module({
  controllers: [PartyLedgerController],
  providers: [PartyLedgerService],
})
export class PartyLedgerModule {}
