import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChallansController } from './challans.controller';
import { ChallansService } from './challans.service';

@Module({
  imports: [NotificationsModule], // NotificationsGateway → live "pending changed" broadcasts
  controllers: [ChallansController],
  providers: [ChallansService],
})
export class ChallansModule {}
