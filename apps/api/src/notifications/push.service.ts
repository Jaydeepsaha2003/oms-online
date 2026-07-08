import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import type { PushSubscriptionRequest, TestNotificationPayload } from '@oms/shared';
import { configuration } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private vapidConfigured = false;

  constructor(private readonly prisma: PrismaService) {}

  /** web-push needs setVapidDetails called once before any send. */
  private ensureVapidConfigured(): void {
    if (this.vapidConfigured) return;
    const { vapid } = configuration();
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    this.vapidConfigured = true;
  }

  /** Stores (or replaces, by endpoint) one device's push subscription. */
  async saveSubscription(userId: string, sub: PushSubscriptionRequest, userAgent?: string): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    });
  }

  /**
   * Sends to every stored subscription, regardless of owner (same "everyone
   * signed in" scope as the WebSocket broadcast). A dead subscription (404/410
   * from the push service) is deleted automatically — self-healing.
   * Returns how many sends were attempted.
   */
  async broadcastPush(payload: TestNotificationPayload): Promise<number> {
    this.ensureVapidConfigured();
    const subscriptions = await this.prisma.pushSubscription.findMany();

    const body = JSON.stringify({
      title: 'OMS test notification',
      body: `Triggered by ${payload.triggeredBy}`,
    });

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
          );
        } catch (err) {
          const webPushErr = err as { statusCode?: number; body?: string; headers?: Record<string, string> };
          const statusCode = webPushErr.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            // DIAGNOSTIC: web-push's own .message is just "Received unexpected response
            // code" with no detail — the real reason is in .statusCode/.body/.headers.
            this.logger.warn(
              `Push send failed for subscription ${sub.id} (endpoint: ${sub.endpoint.slice(0, 60)}...): ` +
                `statusCode=${statusCode} body=${webPushErr.body} headers=${JSON.stringify(webPushErr.headers)}`,
            );
          }
        }
      }),
    );

    return subscriptions.length;
  }
}
