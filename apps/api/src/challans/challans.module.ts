import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { AgentCommissionModule } from '../agent-commission/agent-commission.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { ChallansController } from './challans.controller';
import { ChallansService } from './challans.service';

@Module({
  // AgentCommissionModule → an invoice prices its own agent commission on save,
  // so there is no separate re-pricing step to remember. DispatchModule → the
  // Pending Challan list reads the same in-memory line-lock map the Dispatch
  // Order screen uses, so it can warn a line is mid-dispatch elsewhere. Neither
  // module imports ChallansModule back, so there's no cycle.
  imports: [NotificationsModule, SettingsModule, AgentCommissionModule, DispatchModule],
  controllers: [ChallansController],
  providers: [ChallansService],
})
export class ChallansModule {}
