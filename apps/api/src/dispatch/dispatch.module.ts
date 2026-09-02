import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { DispatchController } from './dispatch.controller';
import { DispatchNotifier } from './dispatch-notifier.service';
import { DispatchService } from './dispatch.service';

@Module({
  // NotificationsModule → gateway + push + audience for dispatch alerts;
  // SettingsModule → the per-event on/off flags. Neither imports DispatchModule,
  // so there is no cycle (ChallansModule already imports this same pair).
  // BookingsModule → withdrawing a dispatch overage from a bag booking; it
  // imports nothing itself, so it adds no cycle either.
  imports: [NotificationsModule, SettingsModule, BookingsModule],
  controllers: [DispatchController],
  providers: [DispatchService, DispatchNotifier],
  // Design Track reads the same pending pool (DispatchService.pendingPool).
  exports: [DispatchService],
})
export class DispatchModule {}
