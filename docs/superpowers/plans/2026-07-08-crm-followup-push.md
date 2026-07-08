# CRM Followup Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A followup becoming due triggers a real push notification (reaching killed/backgrounded apps), once per due-cycle, deep-linking back to the specific card on the CRM board.

**Architecture:** A new `@Interval(60_000)` scheduler (this codebase's first scheduled job) reuses `CrmService`'s existing due-computation logic to find `OPEN`, currently-due, not-yet-pushed followups, and broadcasts through the same WebSocket/Push machinery built for the test-notification feature — generalized to take an arbitrary `{ title, body, data }` rather than hardcoded test text.

**Tech Stack:** `@nestjs/schedule` (new dependency) for the interval; existing `NotificationsGateway`/`PushService`/`web-push`/service-worker infrastructure for delivery.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-07-08-crm-followup-push-design.md](../specs/2026-07-08-crm-followup-push-design.md).
- No test runner in this repo — verification is manual/scripted, same convention as prior plans.
- Push only fires when the CRM `desktopNotifications` setting is on (no new settings UI).
- Broadcasts to everyone with a stored push subscription — no per-user targeting (no assignment field exists on `Followup`).
- Use `prisma db push` for schema changes, not `migrate dev` — this repo's migration history has pre-existing drift from the live dev database (discovered while building the test-notification feature); `migrate dev` will try to reset the database.
- Do not modify the existing `broadcastTest`/`broadcastPush` methods' behavior — add new generic siblings instead, so the already-verified test button keeps working unchanged.

---

### Task 1: `pushSentAt` tracking + due-unpushed query

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/crm/crm.service.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Followup.pushSentAt: DateTime | null` column. `CrmService.dueUnpushed(): Promise<FollowupDto[]>` — Task 3's scheduler calls this.

- [ ] **Step 1: Add the column**

In `apps/api/prisma/schema.prisma`, add this field to `model Followup`, right after `lastRemindedAt DateTime?`:

```prisma
  pushSentAt DateTime? // set once a push has fired for the current due-cycle; cleared on re-promise/snooze/reopen
```

- [ ] **Step 2: Push the schema change**

Run (from `apps/api`): `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.` If it reports drift/offers a reset, **stop and ask** — do not proceed with a reset (see Global Constraints).

Run: `npx prisma generate`
Expected: `Generated Prisma Client` with no errors. If it fails with `EPERM`/file-lock, a running API server is holding the old client open — stop it first (`stop.bat`), then retry.

- [ ] **Step 3: Reset `pushSentAt` at the same three points `nextRemindAt` already resets**

In `apps/api/src/crm/crm.service.ts`, in `addLog` (around line 210), change:

```ts
          ...(newPromised ? { promisedAt: newPromised, nextRemindAt: null } : {}), // re-promise re-opens the window
```

to:

```ts
          ...(newPromised ? { promisedAt: newPromised, nextRemindAt: null, pushSentAt: null } : {}), // re-promise re-opens the window
```

In `snooze` (around line 234), change:

```ts
        data: { nextRemindAt: next, lastRemindedAt: now, remindersToday, remindersDate: todayStr },
```

to:

```ts
        data: { nextRemindAt: next, lastRemindedAt: now, remindersToday, remindersDate: todayStr, pushSentAt: null },
```

In `reopen` (around line 253), change:

```ts
      this.prisma.followup.update({ where: { id }, data: { status: 'OPEN', resolvedAt: null, resolvedByName: null, nextRemindAt: null } }),
```

to:

```ts
      this.prisma.followup.update({ where: { id }, data: { status: 'OPEN', resolvedAt: null, resolvedByName: null, nextRemindAt: null, pushSentAt: null } }),
```

- [ ] **Step 4: Add `dueUnpushed()`, mirroring the existing `due()`**

In `apps/api/src/crm/crm.service.ts`, add this method right after the existing `due()` method:

```ts
  /** Same as due(), but only followups that haven't had a push sent for this cycle yet. */
  async dueUnpushed(): Promise<FollowupDto[]> {
    const rows = await this.prisma.followup.findMany({
      where: { status: 'OPEN', pushSentAt: null },
      include: INCLUDE,
      orderBy: [{ promisedAt: 'asc' }],
    });
    const settings = await this.getSettings();
    const now = new Date();
    return rows.map((r) => this.toDto(r)).filter((f) => computeFollowupState(f, now, settings.leadDays).isActiveNudge);
  }

  /** Marks a followup as pushed for its current due-cycle. */
  async markPushed(id: number): Promise<void> {
    await this.prisma.followup.update({ where: { id }, data: { pushSentAt: new Date() } });
  }
```

- [ ] **Step 5: Build**

Run: `npm run build -w @oms/api` (from repo root)
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/src/crm/crm.service.ts
git commit -m "feat(api): track per-cycle push state on Followup, add dueUnpushed()"
```

---

### Task 2: Generalize the broadcast + export from NotificationsModule

**Files:**
- Modify: `apps/api/src/notifications/notifications.gateway.ts`
- Modify: `apps/api/src/notifications/push.service.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NotificationsGateway.broadcast(notification: { title: string; body: string; data?: Record<string, unknown> }): number` and `PushService.broadcastGeneric(notification: { title: string; body: string; data?: Record<string, unknown> }): Promise<number>` — Task 3's scheduler calls both. `NotificationsGateway` and `PushService` become injectable outside the `notifications` module (needed by `CrmModule` in Task 3).

- [ ] **Step 1: Add the generic gateway broadcast**

In `apps/api/src/notifications/notifications.gateway.ts`, add this method right after `broadcastTest`:

```ts
  /** Generic broadcast for features beyond the test button (e.g. CRM followup reminders). */
  broadcast(notification: { title: string; body: string; data?: Record<string, unknown> }): number {
    this.server.emit('notification', notification);
    return this.server.sockets.sockets.size;
  }
```

- [ ] **Step 2: Add the generic push broadcast**

In `apps/api/src/notifications/push.service.ts`, replace the `broadcastPush` method with this (extracts the shared send-and-cleanup loop into a private helper, used by both the existing test path and the new generic one — behavior for the test button is unchanged):

```ts
  /** Sends to every stored subscription, regardless of owner. A dead subscription
   *  (404/410) is deleted automatically. Returns how many sends were attempted. */
  async broadcastPush(payload: TestNotificationPayload): Promise<number> {
    return this.sendToAll(
      JSON.stringify({ title: 'OMS test notification', body: `Triggered by ${payload.triggeredBy}` }),
    );
  }

  /** Same delivery mechanism as broadcastPush, for any feature that needs its own title/body/data. */
  async broadcastGeneric(notification: { title: string; body: string; data?: Record<string, unknown> }): Promise<number> {
    return this.sendToAll(JSON.stringify(notification));
  }

  private async sendToAll(body: string): Promise<number> {
    this.ensureVapidConfigured();
    const subscriptions = await this.prisma.pushSubscription.findMany();

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
```

- [ ] **Step 3: Export both providers**

In `apps/api/src/notifications/notifications.module.ts`, add an `exports` array:

```ts
@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsGateway, PushService],
  exports: [NotificationsGateway, PushService],
})
export class NotificationsModule {}
```

- [ ] **Step 4: Build**

Run: `npm run build -w @oms/api` (from repo root)
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Verify the test button still works unchanged**

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@oms.local","password":"Admin@12345"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST http://localhost:4000/api/notifications/test -H "Authorization: Bearer $TOKEN"
```

Expected: `{"success":true,"data":{"devicesNotified":N,"pushDevicesNotified":M}}` — same shape as before this task, proving the refactor didn't change the test button's behavior. (Start the API standalone first if it isn't already running: `node dist/src/main.js` from `apps/api`.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notifications/notifications.gateway.ts apps/api/src/notifications/push.service.ts \
  apps/api/src/notifications/notifications.module.ts
git commit -m "refactor(api): generalize notification broadcast for reuse beyond the test button"
```

---

### Task 3: The scheduler itself

**Files:**
- Modify: `apps/api/package.json` (add `@nestjs/schedule`)
- Modify: `apps/api/src/app.module.ts` (register `ScheduleModule.forRoot()`)
- Create: `apps/api/src/crm/followup-push.scheduler.ts`
- Modify: `apps/api/src/crm/crm.module.ts`

**Interfaces:**
- Consumes: `CrmService.dueUnpushed()`/`markPushed()` (Task 1), `NotificationsGateway.broadcast()`/`PushService.broadcastGeneric()` (Task 2).
- Produces: nothing else depends on this — it's a background process, not called directly.

- [ ] **Step 1: Add the dependency**

In `apps/api/package.json`, add to `"dependencies"` (alongside the other `@nestjs/*` packages):

```json
    "@nestjs/schedule": "^4.1.2",
```

Run: `npm install` (from repo root)
Expected: exits 0.

- [ ] **Step 2: Register the schedule module**

In `apps/api/src/app.module.ts`, add the import:

```ts
import { ScheduleModule } from '@nestjs/schedule';
```

And add `ScheduleModule.forRoot(),` to the `imports` array, right after `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),`.

- [ ] **Step 3: Write the scheduler**

```ts
// apps/api/src/crm/followup-push.scheduler.ts
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { FollowupDto } from '@oms/shared';
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
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    const settings = await this.crm.getSettings();
    if (!settings.desktopNotifications) return;

    const due = await this.crm.dueUnpushed();
    for (const f of due) {
      try {
        const notification = this.buildNotification(f);
        this.gateway.broadcast(notification);
        await this.pushService.broadcastGeneric(notification);
        await this.crm.markPushed(f.id);
      } catch (err) {
        this.logger.warn(`Failed to push followup ${f.id}: ${(err as Error).message}`);
      }
    }
  }

  private buildNotification(f: FollowupDto): { title: string; body: string; data: Record<string, unknown> } {
    const promised = f.promisedAt ? ` · promised ${new Date(f.promisedAt).toLocaleDateString('en-GB')}` : '';
    return {
      title: `Follow-up: ${f.partyName}`,
      body: `${f.title}${promised}`,
      data: { followupId: f.id, kind: f.kind },
    };
  }
}
```

- [ ] **Step 4: Wire it into `CrmModule`**

Replace the full contents of `apps/api/src/crm/crm.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { FollowupPushScheduler } from './followup-push.scheduler';
import { GeminiService } from './gemini.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CrmController],
  providers: [CrmService, GeminiService, FollowupPushScheduler],
})
export class CrmModule {}
```

- [ ] **Step 5: Build**

Run: `npm run build -w @oms/api` (from repo root)
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Verify the scheduler actually fires and pushes a real due followup**

Start the API standalone (`node dist/src/main.js` from `apps/api`, backgrounded, logging to a file). Then:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@oms.local","password":"Admin@12345"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# Create a followup promised yesterday, so it's immediately due.
YESTERDAY=$(node -e "console.log(new Date(Date.now()-86400000).toISOString())")
curl -s -X POST http://localhost:4000/api/crm/followups -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"kind\":\"DELIVERY\",\"partyName\":\"Diag Test Party\",\"title\":\"Diag push test\",\"promisedAt\":\"$YESTERDAY\"}"
```

Wait ~65 seconds (past one `@Interval(60_000)` tick), then check the API log for a line like `Follow-up: Diag Test Party` having been broadcast, and confirm via a DB query that `pushSentAt` is now set on that followup:

```bash
cd apps/api && node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.followup.findFirst({ where: { partyName: 'Diag Test Party' } }).then(f => { console.log(f.id, f.pushSentAt); p.\$disconnect(); });
"
```

Expected: `pushSentAt` is a real timestamp, not `null`. If any real devices had push enabled, they should have received a "Follow-up: Diag Test Party" notification.

Clean up the test followup:

```bash
cd apps/api && node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.followup.deleteMany({ where: { partyName: 'Diag Test Party' } }).then(() => p.\$disconnect());
"
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/src/app.module.ts apps/api/src/crm/followup-push.scheduler.ts \
  apps/api/src/crm/crm.module.ts package-lock.json
git commit -m "feat(api): add a scheduler that pushes CRM followups once per due-cycle"
```

---

### Task 4: Frontend deep link + highlight

**Files:**
- Modify: `apps/web/public/sw.js`
- Modify: `apps/web/src/features/crm/followups-page.tsx`

**Interfaces:**
- Consumes: the `data: { followupId, kind }` carried on the push payload (Task 3).
- Produces: nothing else depends on this.

- [ ] **Step 1: Build the URL from the notification's `data` on click**

In `apps/web/public/sw.js`, replace the `push` and `notificationclick` listeners with:

```js
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
      data: data.data ?? {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data ?? {};
  const url = d.followupId
    ? `/${d.kind === 'PAYMENT' ? 'crm/payments' : 'crm'}?followup=${d.followupId}`
    : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client && 'navigate' in client) {
          client.focus();
          return client.navigate(new URL(url, self.location.origin).href);
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
```

- [ ] **Step 2: Scroll to + highlight the linked card**

In `apps/web/src/features/crm/followups-page.tsx`, add the import (alongside the other `react-router-dom`/react imports):

```ts
import { useSearchParams } from 'react-router-dom';
```

In the `FollowupsPage` function component, add this effect right after the existing `useState`/`useMemo` declarations near the top:

```tsx
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('followup');
    if (!id) return;
    const el = document.getElementById(`followup-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-indigo-400', 'ring-offset-2');
    const timer = setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-400', 'ring-offset-2'), 2200);
    return () => clearTimeout(timer);
  }, [searchParams, groups]);
```

(This needs `useEffect` imported — add it to the existing `import { useMemo, useState } from 'react';` line, making it `import { useEffect, useMemo, useState } from 'react';`. Depending on `groups` so it re-runs once the board data has actually loaded, not just on first mount before `groups` is populated.)

In the `FollowupRow` component, add an `id` to the row's root element — change:

```tsx
    <div className="px-3 py-2.5">
```

to:

```tsx
    <div id={`followup-${f.id}`} className="rounded-md px-3 py-2.5 transition-shadow">
```

- [ ] **Step 3: Build and type-check**

Run: `npm run build -w @oms/web` (from repo root)
Expected: exits 0.

Run: `npm run lint -w @oms/web` (from repo root)
Expected: exits 0, no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/sw.js apps/web/src/features/crm/followups-page.tsx
git commit -m "feat(web): deep-link CRM followup push notifications to the specific card"
```

---

### Task 5: Full build, restart, and end-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full monorepo build**

Run (from repo root): `npm run build`
Expected: exits 0.

- [ ] **Step 2: Restart the production servers**

Run: `restart.bat` (repo root)

- [ ] **Step 3: Verify the whole cycle for real**

1. On a device with push already enabled (from the test-notification feature), create a followup with a promised date in the past (via the New Order / CRM UI, or the curl command from Task 3 Step 6).
2. Within ~60 seconds, confirm a push notification arrives with the followup's party name and title.
3. Click it — confirm it opens `/crm` (or `/crm/payments`) with that specific card scrolled into view and briefly highlighted.
4. Snooze that followup, wait for it to become due again (or use its "remind again" interval), and confirm a **second** push arrives once it's due again — proving the per-cycle reset works, not just a one-time send.
5. Resolve a due-and-unpushed followup and confirm no push fires for it afterward.
6. **Hand off to the user** (this agent can't drive a real killed phone): repeat step 2 with the phone's OMS app fully killed, confirming it still arrives — the same closed-app delivery already proven for the test button should now also apply here since it's the same underlying `PushService`.

- [ ] **Step 4: Confirm no regression in the existing in-app reminder**

With `desktopNotifications` on, confirm the existing chime/banner/foreground-notification behavior in `FollowupNudge` still fires exactly as before — this feature is additive, not a replacement.

---

## Self-Review Notes

- **Spec coverage:** server-side trigger (Task 3), once-per-cycle via `pushSentAt` reset at the three existing `nextRemindAt` reset points (Task 1), reuse of the `desktopNotifications` setting with no new UI (Task 3's `tick()`), broadcast-to-everyone / no per-user targeting (unchanged `sendToAll` semantics), generalized broadcast shared with the test button without changing its behavior (Task 2 + Task 2 Step 5's regression check), deep link with auto-highlight (Task 4) — all covered.
- **Placeholder scan:** no TBD/TODO; every step has literal code or an exact command with expected output.
- **Type consistency:** `dueUnpushed(): Promise<FollowupDto[]>` and `markPushed(id): Promise<void>` (Task 1) match their usage in `FollowupPushScheduler` (Task 3). `broadcast()`/`broadcastGeneric()` signatures (Task 2) match their calls in the scheduler (Task 3). The `data: { followupId, kind }` shape produced in `buildNotification` (Task 3) matches exactly what `sw.js`'s `notificationclick` reads (Task 4).
