import { Module } from '@nestjs/common';
import { TallyController } from './tally.controller';
import { TallyService } from './tally.service';
import { TallyPartiesService } from './tally-parties.service';
import { TallyBillsService } from './tally-bills.service';
import { TallyPostingService } from './tally-posting.service';
import { TallySyncScheduler } from './tally-sync.scheduler';
import { TallyNotesService } from './tally-notes.service';
import { BillReadyService } from './bill-ready.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [TallyController],
  providers: [TallyService, TallyPartiesService, TallyBillsService, TallyPostingService, TallySyncScheduler, TallyNotesService, BillReadyService],
  exports: [TallyService, TallyBillsService, BillReadyService],
})
export class TallyModule {}
