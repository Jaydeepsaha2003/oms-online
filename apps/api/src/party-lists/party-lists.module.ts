import { Module } from '@nestjs/common';
import { PartyListsController } from './party-lists.controller';
import { PartyListsService } from './party-lists.service';

@Module({
  controllers: [PartyListsController],
  providers: [PartyListsService],
})
export class PartyListsModule {}
