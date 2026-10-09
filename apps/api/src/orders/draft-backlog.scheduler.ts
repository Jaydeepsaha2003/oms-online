import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ALL_PERMISSIONS } from '@oms/shared';
import { formatDate } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationAudienceService } from '../notifications/notification-audience.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PushService } from '../notifications/push.service';
import { NotificationLedger } from '../notifications/notification-ledger.service';
import { UserPrefsService } from '../notifications/user-prefs.service';

/** A draft untouched this long is backlog, not work in progress. */
const STALE_MS = 60 * 60_000;
/** How often the system admin is reminded while drafts remain. */
const EVERY_MS = 2 * 60 * 60_000;

/**
 * "Clear the draft backlog": while orders sit in DRAFT, the system admin (the
 * `*` grant) is reminded every two hours — on the phone and in the app, never
 * inside their Do-not-disturb hours. Stops by itself once no draft is left.
 */
@Injectable()
export class DraftBacklogScheduler {
  private readonly logger = new Logger(DraftBacklogScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: NotificationAudienceService,
    private readonly gateway: NotificationsGateway,
    private readonly push: PushService,
    private readonly prefs: UserPrefsService,
    private readonly ledger: NotificationLedger,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    // Guarded whole: setInterval does not catch, and an escaping rejection would crash the server.
    try {
      const drafts = await this.prisma.order.findMany({
        where: { status: 'DRAFT', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        select: { id: true, customerName: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!drafts.length) return;
      const admins = await this.prefs.notInDnd(await this.audience.userIdsWith(ALL_PERMISSIONS));
      if (!admins.length) return;
      // One event per two-hour slot: someone in DND at its start still gets it when they wake.
      const key = `draft-backlog:${Math.floor(Date.now() / EVERY_MS)}`;
      const untold = await this.ledger.filterUntold(key, admins);
      if (!untold.length) return;

      const names = drafts.slice(0, 3).map((d) => `#${d.id} ${d.customerName}`);
      const more = drafts.length > 3 ? ` +${drafts.length - 3} more` : '';
      const notification = {
        title: `Draft backlog — ${drafts.length} order${drafts.length === 1 ? '' : 's'} to clear`,
        body: `${names.join(', ')}${more} · oldest since ${formatDate(drafts[0].createdAt)}`,
        data: { kind: 'draft-backlog', url: '/orders?status=DRAFT' },
      };
      this.gateway.notifyUsers(untold, notification);
      await this.push.sendToUsers(untold, notification);
      await this.ledger.record(key, untold, notification.title, notification.body);
    } catch (err) {
      this.logger.warn(`Draft backlog reminder failed: ${(err as Error).message}`);
    }
  }
}
