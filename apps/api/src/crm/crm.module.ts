import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { FollowupPushScheduler } from './followup-push.scheduler';

@Module({
  imports: [NotificationsModule],
  controllers: [CrmController],
  providers: [CrmService, FollowupPushScheduler],
})
export class CrmModule {}
