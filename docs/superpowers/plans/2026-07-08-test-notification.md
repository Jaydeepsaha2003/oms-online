# Test Notification (WebSocket broadcast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Test notifications" card to Settings that broadcasts, over a WebSocket, to every device currently signed into OMS — each receiving device plays a sound (native OS notification sound where permitted, plus an always-on gentle WebAudio chime).

**Architecture:** A NestJS `@WebSocketGateway()` (Socket.IO) validates each connecting socket's JWT the same way the existing `JwtStrategy` does, then broadcasts a `test-notification` event to all connected sockets when `POST /api/notifications/test` is called. Each open browser tab holds one Socket.IO connection (opened from `AppShell`, alive for as long as OMS is open in that tab) and reacts to the event by showing a native `Notification` and playing a new chime.

**Tech Stack:** NestJS (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`) on the backend; `socket.io-client` + the existing WebAudio-based `chime.ts` on the frontend. No new test framework — see Global Constraints.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-07-08-test-notification-design.md](../specs/2026-07-08-test-notification-design.md) — every task below implements a section of it.
- **No test runner is configured anywhere in this repo** (no `jest`/`vitest`, no `test` script in any `package.json`, zero `.spec.ts` files under `apps/api`). Do **not** introduce one as a side effect of this feature — that was an explicit, approved scope decision in the spec ("follows the existing project convention: manual verification"). Every task below is verified manually with exact commands/expected output instead of automated tests.
- Broadcast is to **everyone** signed in (no per-user/per-role targeting) — do not build targeting infrastructure.
- Delivery only needs to reach devices where OMS is **open** (foreground or background tab) — do not build Web Push/VAPID/service-worker push handling.
- Match existing code style: relative imports within each app, `@oms/shared` for cross-app types, `sonner` for toasts, WebAudio (no audio assets) for sound.

---

### Task 1: Shared types for the notification payload

**Files:**
- Create: `packages/shared/src/types/notification.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TestNotificationPayload { triggeredBy: string; at: string }` and `TestNotificationResult { devicesNotified: number }`, both importable from `@oms/shared`. Tasks 2, 3, and 4 all import these.

- [ ] **Step 1: Create the shared types file**

```ts
// packages/shared/src/types/notification.ts

/** Broadcast to every connected device when Settings → "Send test notification" fires. */
export interface TestNotificationPayload {
  /** Display name of the user who triggered the test. */
  triggeredBy: string;
  /** ISO 8601 timestamp of when it was sent. */
  at: string;
}

/** Response body of `POST /notifications/test`. */
export interface TestNotificationResult {
  /** How many devices (open sockets) the broadcast reached, including the sender's own tab. */
  devicesNotified: number;
}
```

- [ ] **Step 2: Export it from the package barrel**

In `packages/shared/src/index.ts`, add this line in the alphabetical-ish block of `export * from './types/...'` lines (next to `./types/note`):

```ts
export * from './types/notification';
```

- [ ] **Step 3: Build the shared package and verify it compiles**

Run: `npm run build:shared` (from the repo root, `D:\OneDrive\Documents\ONLINE-OMS-JAYDEEP-19.06.2026\oms-online`)
Expected: exits 0, no TypeScript errors. `packages/shared/dist/types/notification.d.ts` now exists.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/notification.ts packages/shared/src/index.ts
git commit -m "feat(shared): add TestNotificationPayload/Result types"
```

---

### Task 2: Backend — WebSocket gateway + test-broadcast endpoint

**Files:**
- Modify: `apps/api/package.json` (add `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`)
- Create: `apps/api/src/common/cors-origin.util.ts`
- Modify: `apps/api/src/main.ts` (reuse the new util instead of its inline CORS logic)
- Create: `apps/api/src/notifications/notifications.gateway.ts`
- Create: `apps/api/src/notifications/notifications.controller.ts`
- Create: `apps/api/src/notifications/notifications.module.ts`
- Modify: `apps/api/src/app.module.ts` (register `NotificationsModule`)

**Interfaces:**
- Consumes: `TestNotificationPayload`/`TestNotificationResult` from `@oms/shared` (Task 1). `JwtPayload` from `@oms/shared` (already exists). `AuthenticatedUser` from `apps/api/src/common/types/authenticated-user.ts` (already exists — shape: `{ id, email, name, roles, permissions, sid? }`).
- Produces: `NotificationsGateway.broadcastTest(payload: TestNotificationPayload): number` — Task 4's manual verification calls this indirectly via the REST endpoint. `POST /notifications/test` (full path `/api/notifications/test`, protected by the existing global `JwtAuthGuard`) returning `TestNotificationResult`. The gateway listens on the default Socket.IO path `/socket.io` — Task 3 connects to it.

- [ ] **Step 1: Add the WebSocket dependencies**

In `apps/api/package.json`, add to `"dependencies"` (matching the existing `^11.0.1` style used by the other `@nestjs/*` packages in this file):

```json
    "@nestjs/platform-socket.io": "^11.0.1",
    "@nestjs/websockets": "^11.0.1",
    "socket.io": "^4.8.1",
```

Run: `npm install` (from the repo root)
Expected: exits 0. `apps/api/node_modules/socket.io` now exists.

- [ ] **Step 2: Extract the shared CORS-origin logic**

`apps/api/src/main.ts` currently builds `corsOrigin` inline (a regex allowing `localhost`/private-LAN origins outside production, else a strict allowlist). The new WebSocket gateway needs the exact same policy — pulling it into a small shared util avoids duplicating a security-relevant regex.

```ts
// apps/api/src/common/cors-origin.util.ts
import type { AppConfig } from '../config/configuration';

const PRIVATE_LAN_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/;

export type CorsOriginOption =
  | string[]
  | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);

/**
 * Shared by the HTTP API and the WebSocket gateway: in production, only the
 * configured CORS_ORIGINS are allowed; otherwise any localhost/private-LAN
 * origin is allowed too, so phones/other devices on the same network can
 * reach the app (mirrors the reasoning in vite.config.ts's mkcert setup).
 */
export function buildCorsOrigin(cfg: Pick<AppConfig, 'isProduction' | 'corsOrigins'>): CorsOriginOption {
  if (cfg.isProduction) return cfg.corsOrigins;
  return (origin, callback) => {
    const allowed = !origin || cfg.corsOrigins.includes(origin) || PRIVATE_LAN_ORIGIN.test(origin);
    callback(null, allowed);
  };
}
```

- [ ] **Step 3: Refactor `main.ts` to use it**

In `apps/api/src/main.ts`, replace this block:

```ts
  // In dev, also accept requests from localhost and private-LAN addresses on any
  // port, so the app is reachable from phones/other devices on the same network.
  // credentials:true forbids a wildcard origin, so we reflect allowed ones per request.
  const privateLanOrigin =
    /^https?:\/\/(localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/;
  const corsOrigin = isProduction
    ? corsOrigins
    : (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ): void => {
        // Non-browser clients (curl, native mobile apps) send no Origin header.
        // Deny by withholding CORS headers (browser blocks it) rather than throwing
        // a 500 — keeps the request servable for non-browser callers.
        const allowed = !origin || corsOrigins.includes(origin) || privateLanOrigin.test(origin);
        callback(null, allowed);
      };
```

with:

```ts
  // Same-origin policy shared with the WebSocket gateway — see cors-origin.util.ts.
  const corsOrigin = buildCorsOrigin({ isProduction, corsOrigins });
```

And add the import near the top of `main.ts` (with the other relative imports):

```ts
import { buildCorsOrigin } from './common/cors-origin.util';
```

- [ ] **Step 4: Verify the refactor didn't change behaviour**

Run: `npm run build -w @oms/api` (from repo root)
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Write the gateway**

```ts
// apps/api/src/notifications/notifications.gateway.ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload, TestNotificationPayload } from '@oms/shared';
import { buildCorsOrigin } from '../common/cors-origin.util';
import { configuration } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
@WebSocketGateway({ cors: { origin: buildCorsOrigin(configuration()), credentials: true } })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Rejects the connection unless it carries a currently-valid access token. */
  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    const userId = token ? await this.verifyToken(token) : null;
    if (!userId) {
      client.disconnect(true);
    }
  }

  /** Same checks as JwtStrategy.validate: active user, current token version, session not revoked. */
  private async verifyToken(token: string): Promise<string | null> {
    try {
      const { jwt: jwtCfg } = configuration();
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret: jwtCfg.accessSecret });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { status: true, tokenVersion: true },
      });
      if (!user || user.status !== 'active' || user.tokenVersion !== payload.tv) return null;

      if (payload.sid) {
        const session = await this.prisma.refreshToken.findUnique({
          where: { id: payload.sid },
          select: { revokedAt: true },
        });
        if (!session || session.revokedAt) return null;
      }

      return payload.sub;
    } catch {
      return null;
    }
  }

  /** Broadcasts to every connected (already-authenticated) socket. Returns how many were reached. */
  broadcastTest(payload: TestNotificationPayload): number {
    this.server.emit('test-notification', payload);
    return this.server.sockets.sockets.size;
  }
}
```

- [ ] **Step 6: Write the controller**

```ts
// apps/api/src/notifications/notifications.controller.ts
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
```

- [ ] **Step 7: Write the module and register it**

```ts
// apps/api/src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsGateway],
})
export class NotificationsModule {}
```

In `apps/api/src/app.module.ts`, add the import near the other feature-module imports:

```ts
import { NotificationsModule } from './notifications/notifications.module';
```

and add `NotificationsModule` to the `imports` array, right after `SettingsModule`.

- [ ] **Step 8: Build and boot the API standalone**

Run (from repo root): `npm run build -w @oms/api`
Expected: exits 0, no TypeScript errors.

Run (from `apps/api`): `node dist/src/main.js`
Expected log lines include `API ready on http://localhost:4000/api ...` and no gateway-related startup errors. Leave it running for the next two steps.

- [ ] **Step 9: Verify the endpoint requires auth**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/notifications/test`
Expected: `401`

- [ ] **Step 10: Verify the endpoint works when authenticated**

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@oms.local","password":"Admin@12345"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST http://localhost:4000/api/notifications/test \
  -H "Authorization: Bearer $TOKEN"
```

Expected: JSON body like `{"success":true,"data":{"devicesNotified":0}}` (0 is correct — no sockets are connected yet; Task 3/4 verify the socket side). Stop the server (`Ctrl+C`) once confirmed.

- [ ] **Step 11: Commit**

```bash
git add apps/api/package.json apps/api/src/common/cors-origin.util.ts apps/api/src/main.ts \
  apps/api/src/notifications apps/api/src/app.module.ts
git commit -m "feat(api): add WebSocket gateway + POST /notifications/test broadcast"
```

---

### Task 3: Frontend — Socket.IO connection + sound

**Files:**
- Modify: `apps/web/package.json` (add `socket.io-client`)
- Modify: `apps/web/vite.config.ts` (proxy `/socket.io` like `/api`)
- Modify: `apps/web/src/lib/chime.ts` (add `playTestChime`)
- Create: `apps/web/src/lib/notifications-socket.ts`
- Modify: `apps/web/src/components/layout/app-shell.tsx` (connect on mount)

**Interfaces:**
- Consumes: `TestNotificationPayload` from `@oms/shared` (Task 1). `useAuthStore` (`apps/web/src/stores/auth-store.ts`, already exists — `useAuthStore.getState().accessToken: string | null`).
- Produces: `connectNotificationsSocket(): void` from `notifications-socket.ts` — called once from `AppShell`. `playTestChime(): void` exported from `chime.ts` — also usable directly by Task 4 if ever needed, though Task 4 doesn't call it directly (the socket handler does).

- [ ] **Step 1: Add the client dependency**

In `apps/web/package.json`, add to `"dependencies"` (alongside `axios`):

```json
    "socket.io-client": "^4.8.1",
```

Run: `npm install` (from repo root)
Expected: exits 0. `apps/web/node_modules/socket.io-client` now exists.

- [ ] **Step 2: Proxy `/socket.io` the same way `/api` already is**

In `apps/web/vite.config.ts`, the existing `apiProxy` const is reused for both `server.proxy` and `preview.proxy` — add one more entry to that same object so both pick it up automatically:

```ts
const apiProxy = {
  '/api': {
    target: 'http://localhost:4000',
    changeOrigin: true,
  },
  '/socket.io': {
    target: 'http://localhost:4000',
    changeOrigin: true,
    ws: true,
  },
};
```

- [ ] **Step 3: Add the gentle test chime**

In `apps/web/src/lib/chime.ts`, add this exported function after `playChime()` (it reuses the existing module-private `tone()` and `ensureCtx()` helpers already in this file):

```ts
/**
 * A short, gentle "test notification" chime — a soft ascending triad, clearly
 * distinct from the urgent multi-phase playChime() used for CRM reminders.
 * Always plays (alongside the native OS notification sound where permission
 * was granted), so there's an audible cue even on platforms/browsers that
 * stay silent for web Notifications.
 */
export function playTestChime(): void {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});

  try {
    const now = c.currentTime;
    const notes = [660, 880, 1108]; // E5, A5, C#6 — soft ascending triad
    notes.forEach((freq, i) => {
      tone(c, freq, now + i * 0.14, 0.28, 0.35, 'sine');
    });
  } catch {
    /* audio unavailable — ignore */
  }
}
```

- [ ] **Step 4: Write the socket connection module**

```ts
// apps/web/src/lib/notifications-socket.ts
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import type { TestNotificationPayload } from '@oms/shared';
import { useAuthStore } from '@/stores/auth-store';
import { playTestChime } from './chime';

let socket: Socket | null = null;

/** Shows a native OS notification if permission was granted — the browser/OS controls its sound. */
function showNativeNotification(payload: TestNotificationPayload): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification('OMS test notification', {
      body: `Triggered by ${payload.triggeredBy}`,
      icon: '/icons/icon-192.png',
    });
  } catch {
    /* ignore — some platforms restrict constructing Notification directly */
  }
}

/**
 * Opens one Socket.IO connection for this browser tab (idempotent — safe to
 * call more than once) and keeps it alive for as long as OMS is open here.
 * Reconnects automatically (socket.io-client default behaviour) after a
 * dropped connection, e.g. an API restart.
 */
export function connectNotificationsSocket(): void {
  if (socket) return;
  const token = useAuthStore.getState().accessToken;
  if (!token) return;

  socket = io('/', {
    path: '/socket.io',
    auth: { token },
  });

  socket.on('test-notification', (payload: TestNotificationPayload) => {
    showNativeNotification(payload);
    playTestChime();
    toast.info(`Test notification received (sent by ${payload.triggeredBy})`);
  });
}
```

- [ ] **Step 5: Connect from `AppShell`**

In `apps/web/src/components/layout/app-shell.tsx`, add the import next to the existing `armAudioUnlock` import:

```ts
import { connectNotificationsSocket } from '@/lib/notifications-socket';
```

And extend the existing unlock effect (do not add a second `useEffect` — one combined effect matches how `armAudioUnlock` is already called here):

```ts
  // Unlock the reminder chime on the first interaction (autoplay policy), and
  // open the live connection used for broadcast test notifications.
  useEffect(() => {
    armAudioUnlock();
    connectNotificationsSocket();
  }, []);
```

(This replaces the existing single-line `useEffect(() => armAudioUnlock(), []);`.)

- [ ] **Step 6: Build the web app and verify it compiles**

Run: `npm run build -w @oms/web` (from repo root)
Expected: exits 0, no TypeScript errors, `apps/web/dist/` is regenerated.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts apps/web/src/lib/chime.ts \
  apps/web/src/lib/notifications-socket.ts apps/web/src/components/layout/app-shell.tsx
git commit -m "feat(web): connect to the notifications WebSocket and play a test chime"
```

---

### Task 4: Settings UI + end-to-end verification

**Files:**
- Create: `apps/web/src/features/settings/test-notification-card.tsx`
- Modify: `apps/web/src/features/settings/settings-page.tsx`

**Interfaces:**
- Consumes: `TestNotificationResult` from `@oms/shared` (Task 1). `http` from `apps/web/src/lib/api.ts` (already exists — `http.post<T>(url, body?, config?): Promise<T>`). `getApiErrorMessage` from the same file (already exists).
- Produces: `TestNotificationCard` component, rendered from `SettingsPage`. Nothing else depends on this — it's the final, user-facing task.

- [ ] **Step 1: Write the Settings card**

```tsx
// apps/web/src/features/settings/test-notification-card.tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TestNotificationResult } from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/** Lets any signed-in user broadcast a test sound to every device currently signed into OMS. */
export function TestNotificationCard() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setPermission(await Notification.requestPermission());
  };

  const sendTest = useMutation({
    mutationFn: () => http.post<TestNotificationResult>('/notifications/test'),
    onSuccess: (result) => toast.success(`Sent to ${result.devicesNotified} device(s)`),
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not send test notification')),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-primary" /> Test notifications
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Send a test alert to every device currently signed into OMS, to check that sound and
          notifications work.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {permission !== 'granted' && (
          <Button type="button" variant="outline" onClick={enableNotifications}>
            Enable browser notifications
          </Button>
        )}
        <Button type="button" onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
          {sendTest.isPending ? <Loader2 className="animate-spin" /> : <BellRing />} Send test notification
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Render it from the Settings page**

In `apps/web/src/features/settings/settings-page.tsx`, add the import next to the `MyDevicesCard` import:

```ts
import { TestNotificationCard } from './test-notification-card';
```

And render it right after `<MyDevicesCard />`:

```tsx
      <MyDevicesCard />

      <TestNotificationCard />

      <CompanyCard canEdit={canEdit} />
```

- [ ] **Step 3: Build everything**

Run (from repo root): `npm run build`
Expected: exits 0 (builds `@oms/shared` → `@oms/api` → `@oms/web` in order, no TypeScript errors).

- [ ] **Step 4: End-to-end manual verification (two devices)**

1. From the repo root, run `start.bat` (builds + launches the production servers — this is the actual day-to-day launcher staff use).
2. On the PC, open `https://localhost:4173`, log in, go to **Settings**. Click **Enable browser notifications** and allow the permission prompt.
3. On a phone on the same Wi-Fi, open `https://<LAN-IP>:4173` (shown by `start.bat`), log in with a different session (or the same account in a private/incognito tab).
4. On the PC, click **Send test notification**.
   Expected: a toast reading `Sent to 2 device(s)` (or however many tabs/devices are open) appears on the PC; **both** the PC and the phone play the soft ascending chime within roughly a second, and the PC additionally shows a native OS notification (since permission was granted there).
5. Stop the API (close the "OMS Server" window, or `stop.bat`), then restart it (`start.bat` again) without refreshing either browser tab.
   Expected: after a few seconds, `socket.io-client` reconnects on its own (no page reload). Clicking **Send test notification** again still reaches both devices.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/settings/test-notification-card.tsx apps/web/src/features/settings/settings-page.tsx
git commit -m "feat(web): add Test notifications card to Settings"
```

---

## Self-Review Notes

- **Spec coverage:** audience (broadcast to all, Task 2 Step 5's no-room-targeting `server.emit`), transport (WebSocket, Tasks 2–3), OS-default sound (Task 3 Step 4 `showNativeNotification`), always-on desktop-and-everywhere chime (Task 3 Step 3), Settings UI with permission button (Task 4), Vite proxy for the LAN/mobile HTTPS setup (Task 3 Step 2), manual verification plan (Task 4 Step 4) — all covered.
- **Placeholder scan:** no TBD/TODO; every step has literal, complete code or an exact command with expected output.
- **Type consistency:** `TestNotificationPayload { triggeredBy, at }` and `TestNotificationResult { devicesNotified }` are defined once in Task 1 and used with identical field names in Tasks 2–4 (`NotificationsGateway.broadcastTest`, `NotificationsController.sendTest`, `notifications-socket.ts`, `TestNotificationCard`). `connectNotificationsSocket()` and `playTestChime()` names match between their Task 3 definitions and every place that calls them.
