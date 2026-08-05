import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationAudienceService } from './notification-audience.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsGateway, PushService, NotificationAudienceService],
  exports: [NotificationsGateway, PushService, NotificationAudienceService],
})
export class NotificationsModule {}
