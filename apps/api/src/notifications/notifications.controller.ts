import { Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { TestNotificationResult } from '@oms/shared';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { NotificationsGateway } from './notifications.gateway';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly gateway: NotificationsGateway) {}

  /** Any authenticated user may trigger a test broadcast — it's inert, no @Permissions needed. */
  @Post('test')
  sendTest(@Req() req: Request): TestNotificationResult {
    const user = req.user as AuthenticatedUser;
    const devicesNotified = this.gateway.broadcastTest({
      triggeredBy: user.name,
      at: new Date().toISOString(),
    });
    return { devicesNotified };
  }
}
