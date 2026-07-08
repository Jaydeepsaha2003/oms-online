import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type {
  PushSubscriptionRequest,
  TestNotificationResult,
  VapidPublicKeyResult,
} from '@oms/shared';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { configuration } from '../config/configuration';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly gateway: NotificationsGateway,
    private readonly pushService: PushService,
  ) {}

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
