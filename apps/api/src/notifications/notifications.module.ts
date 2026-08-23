import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SettingsModule } from '../settings/settings.module';
import { ActivityNotifier } from './activity-notifier.service';
import { NotificationAudienceService } from './notification-audience.service';
import { NotificationsController } from './notifications.controller';
import { NotificationLedger } from './notification-ledger.service';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';
import { UserPrefsService } from './user-prefs.service';

@Module({
  // SettingsModule → the master alerting on/off switch ActivityNotifier honours.
  imports: [JwtModule.register({}), SettingsModule],
  controllers: [NotificationsController],
  providers: [NotificationsGateway, PushService, NotificationAudienceService, ActivityNotifier, UserPrefsService, NotificationLedger],
  exports: [NotificationsGateway, PushService, NotificationAudienceService, ActivityNotifier, UserPrefsService, NotificationLedger],
})
export class NotificationsModule {}
