import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { AgentCommissionModule } from '../agent-commission/agent-commission.module';
import { ChallansController } from './challans.controller';
import { ChallansService } from './challans.service';

@Module({
  // AgentCommissionModule → an invoice prices its own agent commission on save,
  // so there is no separate re-pricing step to remember.
  imports: [NotificationsModule, SettingsModule, AgentCommissionModule],
  controllers: [ChallansController],
  providers: [ChallansService],
})
export class ChallansModule {}
