import { Module } from '@nestjs/common';
import { PartyListsController } from './party-lists.controller';
import { PartyListsService } from './party-lists.service';

@Module({
  controllers: [PartyListsController],
  providers: [PartyListsService],
  // The Party Ledger reuses the classifier for its Green/Black-listed KPI.
  exports: [PartyListsService],
})
export class PartyListsModule {}
