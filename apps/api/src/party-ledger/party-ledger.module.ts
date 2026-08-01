import { Module } from '@nestjs/common';
import { PartyListsModule } from '../party-lists/party-lists.module';
import { PartyLedgerController } from './party-ledger.controller';
import { PartyLedgerService } from './party-ledger.service';

@Module({
  // Payment DNA is the party's Green/Black-list standing, so the ledger leans on
  // the same classifier the CRM Party Lists screen uses.
  imports: [PartyListsModule],
  controllers: [PartyLedgerController],
  providers: [PartyLedgerService],
})
export class PartyLedgerModule {}
