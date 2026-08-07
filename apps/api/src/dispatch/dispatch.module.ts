import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { DispatchController } from './dispatch.controller';
import { DispatchNotifier } from './dispatch-notifier.service';
import { DispatchService } from './dispatch.service';

@Module({
  // NotificationsModule → gateway + push + audience for dispatch alerts;
  // SettingsModule → the per-event on/off flags. Neither imports DispatchModule,
  // so there is no cycle (ChallansModule already imports this same pair).
  imports: [NotificationsModule, SettingsModule],
  controllers: [DispatchController],
  providers: [DispatchService, DispatchNotifier],
  // Design Track reads the same pending pool (DispatchService.pendingPool).
  exports: [DispatchService],
})
export class DispatchModule {}
