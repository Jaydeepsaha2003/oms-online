import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { ChallansController } from './challans.controller';
import { ChallansService } from './challans.service';

@Module({
  imports: [NotificationsModule, SettingsModule], // NotificationsGateway → live "pending changed" broadcasts; SettingsService → TCS %
  controllers: [ChallansController],
  providers: [ChallansService],
})
export class ChallansModule {}
