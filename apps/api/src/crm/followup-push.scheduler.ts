import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ACTIONS, type FollowupDto, perm, RESOURCES } from '@oms/shared';
import { formatDate } from '../common/date.util';
import { NotificationAudienceService } from '../notifications/notification-audience.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PushService } from '../notifications/push.service';
import { UserPrefsService } from '../notifications/user-prefs.service';
import { CrmService } from './crm.service';

@Injectable()
export class FollowupPushScheduler {
  private readonly logger = new Logger(FollowupPushScheduler.name);

  constructor(
    private readonly crm: CrmService,
    private readonly gateway: NotificationsGateway,
    private readonly pushService: PushService,
    private readonly audience: NotificationAudienceService,
    private readonly prefs: UserPrefsService,
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

      /*
       * Drop anyone inside their own quiet hours.
       *
       * When EVERYONE is quiet we return before marking anything pushed, so the
       * follow-up is still waiting and goes out once the first window closes —
       * delayed, not cancelled, which is what DND should mean.
       *
       * When only SOME are quiet the push goes to the rest and `markPushed`
       * fires, which is per follow-up rather than per user — so a sleeper does
       * miss that particular ping. They still see the follow-up in the CRM and
       * on the bell, and it pushes again after the next snooze/interval. Making
       * that exact is a per-user push ledger, which is not worth the table until
       * someone actually reports missing one.
       */
      const awake = await this.prefs.notInDnd(recipients);
      if (!awake.length) return;

      for (const f of due) {
        try {
          const notification = this.buildNotification(f);
          this.gateway.notifyUsers(awake, notification);
          await this.pushService.sendToUsers(awake, notification);
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
