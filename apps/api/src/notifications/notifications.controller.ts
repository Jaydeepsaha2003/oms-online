import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import type {
  NotificationDndDto,
  PushSubscriptionRequest,
  TestNotificationResult,
  UserDndRow,
  VapidPublicKeyResult,
} from '@oms/shared';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { Permissions } from '../common/decorators/permissions.decorator';
import { configuration } from '../config/configuration';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';
import { UserPrefsService } from './user-prefs.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly gateway: NotificationsGateway,
    private readonly pushService: PushService,
    private readonly prefs: UserPrefsService,
  ) {}

  /* ── Reminder Do-Not-Disturb (per user, not per installation) ───────────── */

  @Get('dnd')
  getDnd(@Req() req: Request): Promise<NotificationDndDto> {
    return this.prefs.getDnd((req.user as AuthenticatedUser).id);
  }

  @Post('dnd')
  setDnd(@Req() req: Request, @Body() body: NotificationDndDto): Promise<NotificationDndDto> {
    return this.prefs.setDnd((req.user as AuthenticatedUser).id, body);
  }

  /*
   * Managing everybody else's quiet hours.
   *
   * Gated on user:update rather than setting:update — this is staff
   * administration ("when may I disturb Anil"), not an app-wide switch, and it
   * writes the same record that person edits in their own Settings. Anyone who
   * may already edit a user's account may set their hours.
   */

  @Get('dnd/all')
  @Permissions(perm(RESOURCES.USER, ACTIONS.VIEW))
  listDnd(): Promise<UserDndRow[]> {
    return this.prefs.listDnd();
  }

  @Put('dnd/:userId')
  @Permissions(perm(RESOURCES.USER, ACTIONS.UPDATE))
  setDndFor(@Param('userId') userId: string, @Body() body: NotificationDndDto): Promise<UserDndRow> {
    return this.prefs.setDndFor(userId, body);
  }

  /** Any authenticated user may trigger a test broadcast — it's inert, no @Permissions needed. */
  @Post('test')
  async sendTest(@Req() req: Request): Promise<TestNotificationResult> {
    const user = req.user as AuthenticatedUser;
    const payload = { triggeredBy: user.name, at: new Date().toISOString() };
    const devicesNotified = this.gateway.broadcastTest(payload);
    const pushDevicesNotified = await this.pushService.broadcastPush(payload);
    return { devicesNotified, pushDevicesNotified };
  }

  /** The frontend needs this to call pushManager.subscribe(). Not secret — it's a public key. */
  @Get('vapid-public-key')
  getVapidPublicKey(): VapidPublicKeyResult {
    return { publicKey: configuration().vapid.publicKey };
  }

  @Post('push-subscribe')
  async subscribeToPush(@Req() req: Request, @Body() body: PushSubscriptionRequest): Promise<{ success: true }> {
    const user = req.user as AuthenticatedUser;
    await this.pushService.saveSubscription(user.id, body, req.headers['user-agent']);
    return { success: true };
  }
}
