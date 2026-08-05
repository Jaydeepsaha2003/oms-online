import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ACTIONS, type FollowupDto, perm, RESOURCES } from '@oms/shared';
import { formatDate } from '../common/date.util';
import { NotificationAudienceService } from '../notifications/notification-audience.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PushService } from '../notifications/push.service';
import { CrmService } from './crm.service';

@Injectable()
export class FollowupPushScheduler {
  private readonly logger = new Logger(FollowupPushScheduler.name);

  constructor(
    private readonly crm: CrmService,
    private readonly gateway: NotificationsGateway,
    private readonly pushService: PushService,
    private readonly audience: NotificationAudienceService,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    // The whole body is guarded, not just the per-item loop: @nestjs/schedule invokes
    // this via setInterval, which does not catch rejections — an uncaught one here
    // would crash the entire server process every 60s if it ever happened (e.g. a
    // transient SQLite busy/lock error), not just fail this one tick.
    try {
      const settings = await this.crm.getSettings();
      if (!settings.desktopNotifications) return;

      const due = await this.crm.dueUnpushed();
      if (!due.length) return;

      // Follow-up reminders are only useful to people who can open the CRM, so
      // the audience is the page's own permission — resolved once per tick, not
      // per follow-up, and only when something is actually due.
      const recipients = await this.audience.userIdsWith(perm(RESOURCES.CRM, ACTIONS.VIEW));
      if (!recipients.length) return;

      for (const f of due) {
        try {
          const notification = this.buildNotification(f);
          this.gateway.notifyUsers(recipients, notification);
          await this.pushService.sendToUsers(recipients, notification);
          await this.crm.markPushed(f.id);
        } catch (err) {
          this.logger.warn(`Failed to push followup ${f.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Followup push tick failed: ${(err as Error).message}`);
    }
  }

  private buildNotification(f: FollowupDto): { title: string; body: string; data: Record<string, unknown> } {
    const promised = f.promisedAt ? ` · promised ${formatDate(f.promisedAt)}` : '';
    return {
      title: `Follow-up: ${f.partyName}`,
      body: `${f.title}${promised}`,
      data: { followupId: f.id, kind: f.kind },
    };
  }
}
