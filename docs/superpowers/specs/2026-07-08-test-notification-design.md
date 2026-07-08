# Test notification (broadcast sound to every device) — design

Date: 2026-07-08

## Purpose

Settings gets a "Test notifications" card. Clicking "Send test notification"
broadcasts, in real time, to every device where any user is currently signed
into OMS (open tab/app, foreground or background — not devices where OMS is
fully closed). Each receiving device plays a sound, so staff can verify that
real-time alerting actually works, audibly, everywhere, before this channel
is reused for real alerts (e.g. new order / dispatch).

## Scope decisions (confirmed with user)

- **Audience**: every device where *any* user in the company is currently
  signed into OMS — not just the clicking user's own devices.
- **Delivery**: only while OMS is open somewhere on the device (a live
  in-page connection). Does **not** need to reach devices where the browser/
  app is fully closed — that would require full Web Push (VAPID + service
  worker `push` handling + per-device subscription storage), which is out of
  scope here.
- **Transport**: WebSocket (Socket.IO), chosen over Server-Sent Events after
  user preference — gives a reusable bidirectional channel for future
  real-time features, at the cost of one new dependency on each side.

## Architecture

```
Settings card ──POST /api/notifications/test──▶ NotificationsController
                                                        │
                                                        ▼
                                              NotificationsGateway.broadcastTest()
                                                        │
                                          server.emit('test-notification', payload)
                                                        │
                        ┌───────────────────────────────┼───────────────────────────────┐
                        ▼                                ▼                                ▼
                 Tab A (Device 1)                 Tab B (Device 2)                 Tab C (Device 3)
                 Notification() + chime          Notification() + chime          Notification() + chime
```

### Backend — `apps/api/src/notifications/`

- **New dependencies**: `@nestjs/websockets`, `@nestjs/platform-socket.io`,
  `socket.io` (added to `apps/api/package.json`).
- `notifications.gateway.ts` — `@WebSocketGateway()` (Socket.IO), attached to
  the existing NestJS HTTP server (port 4000; no new port).
  - `handleConnection(socket)`: reads the JWT access token from
    `socket.handshake.auth.token`. Validates it the same way
    `JwtStrategy.validate` does today — user exists and `status === 'active'`,
    `tokenVersion` matches, and (if the token carries a `sid`) the
    corresponding `RefreshToken` row is not revoked. Invalid/missing token →
    `socket.disconnect()` immediately. No anonymous listeners.
  - No per-user rooms or targeting — the agreed scope is "every device," so
    any authenticated socket is broadcast to via `server.emit()`. This is a
    deliberate simplification: no targeting infrastructure is built until a
    real need for it exists.
  - `broadcastTest(payload: { triggeredBy: string; at: string })`: emits
    `test-notification` to all connected sockets. Returns the number of
    currently connected sockets.
- `notifications.controller.ts` — `POST /api/notifications/test`, behind the
  existing `JwtAuthGuard` (any authenticated user may trigger a test — it's
  inert). Calls `gateway.broadcastTest(...)` and returns
  `{ devicesNotified: <count> }`.
- `notifications.module.ts` — wires controller + gateway, imported into
  `AppModule`.

### Frontend

- **New dependency**: `socket.io-client` (added to `apps/web/package.json`).
- `src/lib/notifications-socket.ts` — opens one Socket.IO connection per
  browser tab, using the current access token from `useAuthStore`
  (`io(..., { auth: { token } })`). Reconnects automatically
  (socket.io-client default behaviour) if the connection drops, e.g. after an
  API restart.
- Mounted once from `src/components/layout/app-shell.tsx` (root of the
  authenticated app), so the connection is alive on every page, not only
  Settings — satisfies "as long as OMS is open somewhere on the device,"
  regardless of which screen is showing.
- On receiving `test-notification`:
  1. If `Notification.permission === 'granted'`, show a native
     `new Notification(...)`. This is what surfaces the **OS/browser default
     notification sound** — the browser controls that sound, not app code.
  2. **Always** also call a new `playTestChime()` in `src/lib/chime.ts` — a
     short, gentle WebAudio-synthesized chime (2–3 soft ascending tones),
     distinct from the existing loud/urgent `playChime()` used for CRM
     reminders. No audio asset, consistent with how `chime.ts` already works.
     This plays on **every platform**, not desktop-only — reliable
     desktop/mobile detection from a browser is fragile, and layering a soft
     chime under a native sound is harmless everywhere. (Flagged to the user
     during design; no objection raised.)
  3. Shows a `sonner` toast as an in-app visual confirmation too, since not
     every device will have notification permission granted.

### Vite proxy — required for the LAN/mobile setup already in place

`apps/web/vite.config.ts` currently proxies only `/api` to
`http://localhost:4000`, specifically so phones on HTTPS never hit
mixed-content errors (see existing comment in that file). Socket.IO defaults
to the `/socket.io` path, so that same proxy pattern is extended:

```ts
const socketProxy = { '/socket.io': { target: 'http://localhost:4000', ws: true, changeOrigin: true } };
```

Added to both the `server.proxy` and `preview.proxy` blocks (mirroring how
`apiProxy` is already applied to both), so the browser only ever talks to the
single HTTPS origin (`:6173` in dev, `:4173` in production/`start.bat`) and
Vite/the preview server handles the WebSocket upgrade to the plain-HTTP API
internally — exactly the same reasoning as the existing `/api` proxy.

### Settings UI

New `TestNotificationCard` in `apps/web/src/features/settings/`, placed next
to the existing `MyDevicesCard` in `settings-page.tsx`:

- If `Notification.permission` is not `'granted'`, show an "Enable browser
  notifications" button that calls `Notification.requestPermission()` (must
  be a direct click handler — browsers require a user gesture, so this can't
  fire automatically).
- A "Send test notification" button → `POST /api/notifications/test` → on
  success, toast `Sent to N device(s)`.
- Every device that receives the broadcast (including the sender's own tab)
  independently shows its own native notification + chime + toast.

## Edge cases

- **Zero other devices connected**: still succeeds; `devicesNotified` simply
  reflects however many sockets are live (at minimum the sender's own tab).
- **Notification permission denied/blocked**: the native OS notification is
  skipped (browser-level restriction, not a bug); the WebAudio chime and
  in-app toast still fire, so there's always *some* signal.
- **Socket disconnects** (server restart, network blip): `socket.io-client`
  reconnects automatically with its default backoff; no custom reconnect
  logic needed.
- **Multiple tabs, same device**: each tab holds its own socket and plays its
  own sound independently. Not deduplicated — acceptable for a test feature.
- **Unauthenticated connection attempts**: rejected at `handleConnection`,
  same trust boundary as the existing REST API.

## Testing plan

No existing automated test suite covers comparable real-time features in
this codebase (checked — no `.spec.ts` files under `apps/api`), so this
follows the existing project convention: **manual verification**, matching
the size/stakes of an internal tool. Verification plan:

1. Run the app via `start.bat` (production build, matches how staff actually
   use it).
2. Open OMS on two devices (desktop browser + phone over LAN IP), both
   logged in.
3. On one device, go to Settings → Test notifications → Send test
   notification.
4. Confirm: toast shows the correct device count, both devices play a sound
   (native notification sound where permission was granted, WebAudio chime
   regardless), and the in-app toast appears on both.
5. Confirm a stopped/restarted API server causes the socket to reconnect
   without a page refresh.

## Out of scope (explicitly deferred)

- True Web Push (VAPID, service worker `push` handler, per-device
  subscription storage) for devices where OMS is fully closed.
- Per-user or per-role targeting of notifications (only "broadcast to
  everyone" is built).
- Reusing this channel for real business alerts (new order, dispatch ready,
  etc.) — this spec only covers the test button and the transport it proves
  out.
