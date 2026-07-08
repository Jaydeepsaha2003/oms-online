# Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Settings "Send test notification" button also reach devices where OMS is fully killed, via real Web Push, alongside the existing WebSocket path (which only reaches open apps).

**Architecture:** A `PushSubscription` Prisma model stores one row per device (endpoint + encryption keys), mirroring how `RefreshToken` already models one row per device session. The `web-push` library signs and sends to each stored subscription using a VAPID key pair; the browser wakes the app's service worker on receipt, even fully closed, and the worker calls `showNotification()`. The frontend's existing "Enable browser notifications" button is upgraded to also create this subscription.

**Tech Stack:** `web-push` (VAPID signing + sending) on the backend; the browser's native `PushManager`/`Notification` APIs and the existing hand-written `sw.js` service worker on the frontend.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-07-08-web-push-notifications-design.md](../specs/2026-07-08-web-push-notifications-design.md) — every task implements a section of it.
- **No test runner is configured in this repo** (confirmed again for this feature — no jest/vitest, no `test` script). Verification is manual/scripted with exact commands, same convention as the rest of this project.
- Supplements, does not replace, the existing Socket.IO broadcast from [2026-07-08-test-notification.md](2026-07-08-test-notification.md).
- Scope stays to the test-notification button — no reusable "send an alert" service, no manual unsubscribe UI.
- **Delivery under OS Low Power Mode/Battery Saver is never guaranteed** — do not write verification steps that treat this as pass/fail.
- This agent cannot drive a real phone or a real browser for this project (the Preview browser tool is scoped to a different project directory, confirmed earlier in this session) — Task 6's on-device checks are handed to the user to run, with exact steps, rather than claimed as self-verified.

---

### Task 1: Shared types for push subscriptions

**Files:**
- Modify: `packages/shared/src/types/notification.ts`

**Interfaces:**
- Consumes: nothing new (extends the file from the previous feature).
- Produces: `PushSubscriptionKeys { p256dh: string; auth: string }`, `PushSubscriptionRequest { endpoint: string; keys: PushSubscriptionKeys }`, `VapidPublicKeyResult { publicKey: string }`. `TestNotificationResult` gains `pushDevicesNotified: number`. Tasks 3 and 4 import these.

- [ ] **Step 1: Add the new types and extend the existing result type**

In `packages/shared/src/types/notification.ts`, replace the whole file with:

```ts
/** Broadcast to every connected device when Settings → "Send test notification" fires. */
export interface TestNotificationPayload {
  /** Display name of the user who triggered the test. */
  triggeredBy: string;
  /** ISO 8601 timestamp of when it was sent. */
  at: string;
}

/** Response body of `POST /notifications/test`. */
export interface TestNotificationResult {
  /** How many devices had an open WebSocket connection (existing path). */
  devicesNotified: number;
  /** How many stored push subscriptions a send was attempted against (new — reaches closed apps). */
  pushDevicesNotified: number;
}

/** The two encryption keys every Web Push subscription carries. */
export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/** Body of `POST /notifications/push-subscribe` — the browser's PushSubscription, JSON-shaped. */
export interface PushSubscriptionRequest {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

/** Response body of `GET /notifications/vapid-public-key`. */
export interface VapidPublicKeyResult {
  publicKey: string;
}
```

- [ ] **Step 2: Build the shared package**

Run: `npm run build:shared` (from the repo root)
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/notification.ts
git commit -m "feat(shared): add push-subscription types, extend TestNotificationResult"
```

---

### Task 2: Database model + VAPID configuration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/.env`, `apps/api/.env.example`
- Modify: `apps/api/src/config/configuration.ts`
- Modify: `apps/api/package.json` (add `web-push`, `@types/web-push`)

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `PushSubscription` (fields: `id`, `userId`, `endpoint` (unique), `p256dh`, `auth`, `userAgent`, `createdAt`) and `prisma.pushSubscription` client accessor — Task 3 uses this. `AppConfig.vapid: { publicKey: string; privateKey: string; subject: string }` — Task 3 uses this via `configuration()`.

- [ ] **Step 1: Add the Prisma model**

In `apps/api/prisma/schema.prisma`, add this model right after the existing `RefreshToken` model (before the `// ─── Audit trail...` comment):

```prisma
model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  userAgent String?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("push_subscriptions")
}
```

And add the back-relation to the `User` model, right after the existing `refreshTokens RefreshToken[]` line:

```prisma
  pushSubscriptions PushSubscription[]
```

- [ ] **Step 2: Generate the VAPID key pair**

Run: `npx web-push generate-vapid-keys` (from `apps/api` — npx will fetch `web-push` temporarily even before it's added to `package.json`)
Expected: prints a `Public Key` and a `Private Key`. Copy both — they're needed in the next step.

- [ ] **Step 3: Add the VAPID env vars**

In `apps/api/.env`, add (using the real keys generated in Step 2):

```
VAPID_PUBLIC_KEY="<paste the Public Key from Step 2>"
VAPID_PRIVATE_KEY="<paste the Private Key from Step 2>"
VAPID_SUBJECT="mailto:admin@oms.local"
```

In `apps/api/.env.example`, add (placeholders only, matching the existing JWT-secret placeholder style):

```
# Web Push — generate a key pair once with:
#   npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY="change-me-vapid-public-key"
VAPID_PRIVATE_KEY="change-me-vapid-private-key"
VAPID_SUBJECT="mailto:you@example.com"
```

- [ ] **Step 4: Wire the config into `configuration.ts`**

In `apps/api/src/config/configuration.ts`, add this interface next to `JwtConfig`:

```ts
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}
```

Add `vapid: VapidConfig;` to the `AppConfig` interface, right after `jwt: JwtConfig;`.

In the `configuration` function's returned object, add this right after the `jwt: { ... }` block:

```ts
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
      privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
      subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@oms.local',
    },
```

- [ ] **Step 5: Add the `web-push` dependency**

In `apps/api/package.json`, add to `"dependencies"` (alphabetically, next to `socket.io`):

```json
    "web-push": "^3.6.7",
```

Add to `"devDependencies"` (alphabetically, next to `typescript`... actually before it):

```json
    "@types/web-push": "^3.6.4",
```

Run: `npm install` (from the repo root)
Expected: exits 0. `node_modules/web-push` exists (root, due to workspace hoisting).

- [ ] **Step 6: Create and apply the migration**

Run (from `apps/api`): `npx prisma migrate dev --name add_push_subscription`
Expected: prints `Your database is now in sync with your schema` (or similar), creates a new folder under `apps/api/prisma/migrations/`, and regenerates the Prisma client. This command is run directly (not via the `db:migrate` npm script) so the migration name is passed non-interactively.

- [ ] **Step 7: Verify the client has the new model**

Run: `npm run build -w @oms/api` (from the repo root)
Expected: exits 0, no TypeScript errors (confirms `prisma.pushSubscription` and `AppConfig.vapid` both type-check).

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/.env.example \
  apps/api/src/config/configuration.ts apps/api/package.json package-lock.json
git commit -m "feat(api): add PushSubscription model, VAPID config, web-push dependency"
```

Note: `apps/api/.env` is not committed (it's gitignored, same as the rest of that file) — only `.env.example` is.

---

### Task 3: Backend — save subscriptions and broadcast via push

**Files:**
- Create: `apps/api/src/notifications/push.service.ts`
- Modify: `apps/api/src/notifications/notifications.controller.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts`

**Interfaces:**
- Consumes: `PushSubscriptionRequest`, `TestNotificationPayload`, `TestNotificationResult` from `@oms/shared` (Task 1). `prisma.pushSubscription`, `configuration().vapid` (Task 2).
- Produces: `PushService.saveSubscription(userId: string, sub: PushSubscriptionRequest, userAgent?: string): Promise<void>` and `PushService.broadcastPush(payload: TestNotificationPayload): Promise<number>` — used by the controller in this task, and nothing outside it.

- [ ] **Step 1: Write the push service**

```ts
// apps/api/src/notifications/push.service.ts
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
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            this.logger.warn(`Push send failed for subscription ${sub.id}: ${(err as Error).message}`);
          }
        }
      }),
    );

    return subscriptions.length;
  }
}
```

- [ ] **Step 2: Add the two new endpoints and extend `sendTest`**

Replace the full contents of `apps/api/src/notifications/notifications.controller.ts` with:

```ts
// apps/api/src/notifications/notifications.controller.ts
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
```

- [ ] **Step 3: Register `PushService` in the module**

Replace the full contents of `apps/api/src/notifications/notifications.module.ts` with:

```ts
// apps/api/src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsGateway, PushService],
})
export class NotificationsModule {}
```

- [ ] **Step 4: Build**

Run: `npm run build -w @oms/api` (from the repo root)
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Boot the API standalone and verify the new endpoints**

Run (from `apps/api`): `node dist/src/main.js` (leave running for the next checks)
Expected log line: `Mapped {/api/notifications/vapid-public-key, GET} route` and `Mapped {/api/notifications/push-subscribe, POST} route`.

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@oms.local","password":"Admin@12345"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

echo "--- vapid public key ---"
curl -s http://localhost:4000/api/notifications/vapid-public-key -H "Authorization: Bearer $TOKEN"

echo "--- subscribe with a deliberately-fake FCM-shaped endpoint ---"
curl -s -X POST http://localhost:4000/api/notifications/push-subscribe \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"endpoint":"https://fcm.googleapis.com/fcm/send/fake-token-for-testing","keys":{"p256dh":"BNJxw7sW9c3q9qz9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9F9Z9A","auth":"fakeauthkey12"}}'

echo "--- trigger broadcast (expect pushDevicesNotified: 1, and no server crash) ---"
curl -s -X POST http://localhost:4000/api/notifications/test -H "Authorization: Bearer $TOKEN"
```

Expected: the vapid-public-key call returns `{"success":true,"data":{"publicKey":"..."}}` (a real base64url string, not empty — if empty, Step 3's `.env` values weren't picked up, restart the server). The subscribe call returns `{"success":true,"data":{"success":true}}`. The broadcast call returns `{"success":true,"data":{"devicesNotified":0,"pushDevicesNotified":1}}` and — critically — the server process does **not** crash or hang (proves a failed push send is caught, not thrown).

- [ ] **Step 6: Confirm the fake subscription gets cleaned up (or at least doesn't wedge anything)**

The fake endpoint from Step 5 will fail (it's not a real FCM registration). Check the server log for either a `Push send failed for subscription ...` warning (caught, non-404/410 failure — acceptable) or silence with the row removed. Either way confirms error handling doesn't crash the broadcast. Then stop the server (`Ctrl+C`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/notifications/push.service.ts apps/api/src/notifications/notifications.controller.ts \
  apps/api/src/notifications/notifications.module.ts
git commit -m "feat(api): send test notifications via Web Push to every stored subscription"
```

---

### Task 4: Frontend — subscribe to push and receive it in the service worker

**Files:**
- Modify: `apps/web/public/sw.js`
- Create: `apps/web/src/lib/push-subscription.ts`

**Interfaces:**
- Consumes: `PushSubscriptionRequest`, `VapidPublicKeyResult` from `@oms/shared` (Task 1). `http` from `apps/web/src/lib/api.ts` (already exists).
- Produces: `subscribeToPush(): Promise<{ ok: true } | { ok: false; reason: string }>` from `push-subscription.ts` — Task 5 calls this.

- [ ] **Step 1: Add push handling to the service worker**

In `apps/web/public/sw.js`, add this at the end of the file (after the existing `fetch` listener):

```js
// Web Push — fires even when the app is fully closed; the browser wakes this
// worker in its own background process to handle it.
self.addEventListener('push', (event) => {
  let data = { title: 'OMS notification', body: '' };
  try {
    data = event.data.json();
  } catch {
    /* non-JSON or missing payload — use the default above */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    }),
  );
});
```

- [ ] **Step 2: Write the subscribe helper**

```ts
// apps/web/src/lib/push-subscription.ts
import type { PushSubscriptionRequest, VapidPublicKeyResult } from '@oms/shared';
import { http } from './api';

export type SubscribeResult = { ok: true } | { ok: false; reason: string };

const UNSUPPORTED_REASON =
  'This browser/app does not support push notifications. On iPhone, add OMS to your Home Screen first (needs iOS 16.4 or later).';

/** Converts a VAPID base64url public key into the Uint8Array pushManager.subscribe() needs. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** True if this browser has an active push subscription right now (used to render button state). */
export async function hasActivePushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return !!existing && Notification.permission === 'granted';
}

/** Requests permission, subscribes to push, and registers the subscription with the server. */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: UNSUPPORTED_REASON };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'Notification permission was not granted.' };
  }

  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await http.get<VapidPublicKeyResult>('/notifications/vapid-public-key');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
  if (!json.endpoint || !json.keys) {
    return { ok: false, reason: 'Push subscription is missing its endpoint or encryption keys.' };
  }

  const body: PushSubscriptionRequest = { endpoint: json.endpoint, keys: json.keys };
  await http.post('/notifications/push-subscribe', body);
  return { ok: true };
}
```

- [ ] **Step 3: Build and type-check**

Run: `npm run build -w @oms/web` (from the repo root)
Expected: exits 0, no TypeScript errors.

Run: `npm run lint -w @oms/web` (from the repo root)
Expected: exits 0, no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/sw.js apps/web/src/lib/push-subscription.ts
git commit -m "feat(web): handle push events in the service worker; add subscribeToPush()"
```

---

### Task 5: Settings UI — upgrade the enable button

**Files:**
- Modify: `apps/web/src/features/settings/test-notification-card.tsx`

**Interfaces:**
- Consumes: `subscribeToPush`, `hasActivePushSubscription` from `push-subscription.ts` (Task 4). `TestNotificationResult` from `@oms/shared` (now has `pushDevicesNotified`, Task 1).
- Produces: nothing else depends on this — final user-facing task.

- [ ] **Step 1: Replace the card**

Replace the full contents of `apps/web/src/features/settings/test-notification-card.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TestNotificationResult } from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { hasActivePushSubscription, subscribeToPush } from '@/lib/push-subscription';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/** Lets any signed-in user broadcast a test sound to every device currently signed into OMS. */
export function TestNotificationCard() {
  const [enabled, setEnabled] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasActivePushSubscription().then((active) => {
      if (!cancelled) setEnabled(active);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enableNotifications = async () => {
    setEnabling(true);
    const result = await subscribeToPush();
    setEnabling(false);
    if (result.ok) {
      setEnabled(true);
      setUnsupportedReason(null);
      toast.success('Notifications enabled on this device');
    } else {
      setUnsupportedReason(result.reason);
      toast.error(result.reason);
    }
  };

  const sendTest = useMutation({
    mutationFn: () => http.post<TestNotificationResult>('/notifications/test'),
    onSuccess: (result) =>
      toast.success(
        `Sent to ${result.devicesNotified} open device(s), attempted push on ${result.pushDevicesNotified} device(s)`,
      ),
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not send test notification')),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-primary" /> Test notifications
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Send a test alert to every device currently signed into OMS — including devices where
          the app is closed, once notifications are enabled there.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {!enabled && (
          <Button type="button" variant="outline" onClick={enableNotifications} disabled={enabling}>
            {enabling ? <Loader2 className="animate-spin" /> : <BellRing />} Enable notifications
          </Button>
        )}
        {unsupportedReason && <p className="text-muted-foreground w-full text-xs">{unsupportedReason}</p>}
        <Button type="button" onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
          {sendTest.isPending ? <Loader2 className="animate-spin" /> : <BellRing />} Send test notification
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Build and type-check**

Run: `npm run build -w @oms/web` (from the repo root)
Expected: exits 0.

Run: `npm run lint -w @oms/web` (from the repo root)
Expected: exits 0, no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/settings/test-notification-card.tsx
git commit -m "feat(web): upgrade the notification button to also subscribe to push"
```

---

### Task 6: Full build + on-device verification

**Files:** none (verification only).

**Interfaces:** none — this task only exercises what Tasks 1–5 produced.

- [ ] **Step 1: Full monorepo build**

Run (from the repo root): `npm run build`
Expected: exits 0 (builds `@oms/shared` → `@oms/api` → `@oms/web` in order).

- [ ] **Step 2: Restart the production servers**

Run: `restart.bat` (repo root)
Expected: rebuilds and relaunches; prints the "On this PC" / "On your phone" URLs.

- [ ] **Step 3 (hand-off to the user — requires a real browser and a real phone this agent cannot drive):**

1. On the PC, open the app, go to **Settings**, click **Enable notifications**, allow the permission prompt.
2. **Fully close the browser** (not just the tab — quit the application).
3. From another device (or `curl`, using the login+test commands from Task 3 Step 5), trigger a test notification.
4. Confirm a system notification appears on the PC with its default sound, even though the browser was closed.
5. On a phone with OMS added to the Home Screen (iOS 16.4+, or Android Chrome), open the installed app, go to Settings, click **Enable notifications**.
6. Force-kill the app (swipe it away from the app switcher/recent-apps view).
7. Trigger a test notification again. Confirm it arrives on the phone.
8. As a non-blocking, informational check only: repeat with the phone in Low Power Mode / Battery Saver and note what happens — this is not expected to be 100% reliable (see Global Constraints) and is not a failure if delivery is delayed or skipped.

- [ ] **Step 4: Confirm no regressions in the existing WebSocket path**

Repeat the two-device WebSocket check from the previous plan (both devices with OMS *open* still get the instant chime) to confirm this feature was additive, not a regression.

---

## Self-Review Notes

- **Spec coverage:** subscription storage (Task 2), VAPID setup (Task 2), send-and-cleanup logic (Task 3), service worker `push`/`notificationclick` handlers (Task 4), upgraded single-button opt-in UX (Task 5), unsupported-platform copy (Task 5's `unsupportedReason`), "supplement not replace" (Task 3's `sendTest` calls both `gateway.broadcastTest` and `pushService.broadcastPush`), Low Power Mode as observational-only (Task 6 Step 3.8) — all covered. No reusable alert service or unsubscribe UI was added, matching the spec's explicit exclusions.
- **Placeholder scan:** no TBD/TODO; every step has literal code or an exact command with expected output. The fake FCM endpoint in Task 3 Step 5 is a deliberately-invalid test fixture, not a placeholder for real logic.
- **Type consistency:** `PushSubscriptionRequest { endpoint, keys: { p256dh, auth } }` is defined once in Task 1 and used identically in `PushService.saveSubscription`, `NotificationsController.subscribeToPush`, and `push-subscription.ts`'s `subscribeToPush()`. `TestNotificationResult { devicesNotified, pushDevicesNotified }` matches between the controller (Task 3) and the card (Task 5). `subscribeToPush()` and `hasActivePushSubscription()` names match between their Task 4 definitions and Task 5's imports.
