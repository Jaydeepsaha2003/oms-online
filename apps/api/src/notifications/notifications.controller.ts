import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import type {
  EffectiveDndDto,
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

  /*
   * The company-wide window, which everyone follows unless they have their own.
   *
   * Reading it is ungated: any signed-in user is entitled to know what quiet
   * hours apply to them. Changing it needs setting:update — it moves everybody.
   */
  @Get('dnd/default')
  getDefaultDnd(): Promise<NotificationDndDto> {
    return this.prefs.getDefaultDnd();
  }

  @Put('dnd/default')
  @Permissions(perm(RESOURCES.SETTING, ACTIONS.UPDATE))
  setDefaultDnd(@Body() body: NotificationDndDto): Promise<NotificationDndDto> {
    return this.prefs.setDefaultDnd(body);
  }

  /** This user's own window — the company default until they override it. */
  @Get('dnd')
  getDnd(@Req() req: Request): Promise<EffectiveDndDto> {
    return this.prefs.getDnd((req.user as AuthenticatedUser).id);
  }

  @Post('dnd')
  setDnd(@Req() req: Request, @Body() body: NotificationDndDto): Promise<NotificationDndDto> {
    return this.prefs.setDnd((req.user as AuthenticatedUser).id, body);
  }

  /** Stop overriding — follow the company default again. */
  @Delete('dnd')
  clearDnd(@Req() req: Request): Promise<EffectiveDndDto> {
    return this.prefs.clearDnd((req.user as AuthenticatedUser).id);
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

  /*
   * Declared AFTER `dnd/default` on purpose — Nest matches routes in declaration
   * order, so a `:userId` route above it would swallow `/dnd/default` and try to
   * save a user called "default". The service also refuses that id outright, so
   * reordering these methods cannot silently corrupt the company setting.
   */
  @Put('dnd/:userId')
  @Permissions(perm(RESOURCES.USER, ACTIONS.UPDATE))
  setDndFor(@Param('userId') userId: string, @Body() body: NotificationDndDto): Promise<UserDndRow> {
    return this.prefs.setDndFor(userId, body);
  }

  /** Put one person back on the company default. */
  @Delete('dnd/:userId')
  @Permissions(perm(RESOURCES.USER, ACTIONS.UPDATE))
  clearDndFor(@Param('userId') userId: string): Promise<UserDndRow> {
    return this.prefs.clearDndFor(userId);
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
