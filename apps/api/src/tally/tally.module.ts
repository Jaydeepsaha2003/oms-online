import { Module } from '@nestjs/common';
import { TallyController } from './tally.controller';
import { TallyService } from './tally.service';
import { TallyPartiesService } from './tally-parties.service';
import { TallyBillsService } from './tally-bills.service';
import { TallyPostingService } from './tally-posting.service';
import { TallySyncScheduler } from './tally-sync.scheduler';
import { TallyNotesService } from './tally-notes.service';

@Module({
  controllers: [TallyController],
  providers: [TallyService, TallyPartiesService, TallyBillsService, TallyPostingService, TallySyncScheduler, TallyNotesService],
  exports: [TallyService],
})
export class TallyModule {}
