# Web Push for closed/backgrounded devices — design

Date: 2026-07-08

## Purpose

The test-notification feature (see
[2026-07-08-test-notification-design.md](2026-07-08-test-notification-design.md))
only reaches a device while OMS is open there — a live WebSocket connection
requires running JavaScript, so a fully killed app has no way to receive it.
Confirmed with the user: clicking "kill the app" on a phone and then sending
a test notification produces nothing there. This spec adds real Web Push so
the test notification (and, later, real alerts — though that reuse is out of
scope here) can reach a device even when the app is completely closed.

## Scope decisions (confirmed with user)

- **Supplement, don't replace**: the existing Socket.IO broadcast stays for
  devices with OMS open (instant, no subscription step). Web Push is added
  *alongside* it for closed/backgrounded devices. Clicking "Send test
  notification" fires both channels.
- **Opt-in UX**: the existing "Enable browser notifications" button in
  Settings is upgraded in place to "Enable notifications" and does both
  steps — permission + push subscription — in one click, rather than adding
  a second separate button.
- **Scope stays to the test button** — no reusable "send an alert" service
  for other features (new orders, dispatch, etc.) is built now. That would
  be a separate, later design.
- **No manual "disable notifications" flow** — rely on the browser's own
  permission settings plus automatic cleanup of dead subscriptions (see
  Edge Cases). Kept out to match the tight scope above.
- **Explicit, permanent limitation, not a bug to fix**: this cannot
  guarantee delivery under Low Power Mode (iOS) or Battery Saver/Doze
  (Android). Those are OS-level throttles on background wake-ups and
  network activity that apply to native apps too, not just web/PWA ones. Web
  Push makes closed-app delivery *much* more reliable than today (which is
  "never"), but "always, even under power saving" isn't something any app —
  web or native — can promise. Verification below treats this as an
  observed-best-effort check, not a pass/fail gate.
- **iOS constraint to design around**: Web Push for an installed PWA
  requires iOS 16.4+, and the user must grant permission *from inside the
  installed app* (Home Screen icon), not from a Safari browser tab. The UI
  must detect when Push isn't supported and say why, rather than showing a
  silently-broken button.

## Architecture

```
Settings → "Enable notifications" click
    → Notification.requestPermission()
    → registration.pushManager.subscribe(VAPID public key)
    → POST /api/notifications/push-subscribe  { endpoint, keys: { p256dh, auth } }
    → stored as a PushSubscription row (one per device, like RefreshToken)

Settings → "Send test notification" click
    → POST /api/notifications/test
        ├─▶ NotificationsGateway.broadcastTest()   (existing — open devices, instant)
        └─▶ PushService.broadcastPush()            (new — every stored subscription)
                → web-push sendNotification() per row
                → dead subscription (404/410) → row deleted automatically
                        │
                        ▼
              Device's service worker `push` event fires — even fully closed —
              OS wakes it, shows the notification (sound per OS default),
              regardless of whether any OMS tab/window is open.
```

### Backend

- **New dependency**: `web-push` (+ `@types/web-push` dev dependency) in
  `apps/api/package.json`. This is the standard library for Web Push —
  it handles VAPID signing and the protocol differences between push
  services (FCM for Chrome/Android, Apple's for Safari/iOS, Mozilla's for
  Firefox) so none of that needs hand-rolling.
- **New env vars** (`apps/api/.env`, `.env.example`): `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` contact), generated once
  via `web-push`'s own `generate-vapid-keys` CLI — same pattern as the
  existing hand-set JWT secrets.
- **New Prisma model** `PushSubscription`: `userId`, `endpoint` (unique),
  `p256dh`, `auth`, `userAgent`, `createdAt` — one row per device, mirroring
  how `RefreshToken` already models "one row per device session." Requires
  a migration (`npm run db:migrate -w @oms/api`).
- **New `PushService`** (in the existing `notifications` module):
  - `saveSubscription(userId, { endpoint, keys }, userAgent)` — upserts by
    `endpoint` (a device re-subscribing, e.g. after clearing site data,
    just overwrites its old row).
  - `broadcastPush(payload: TestNotificationPayload)` — fetches every
    `PushSubscription` row and calls `web-push`'s `sendNotification` for
    each. A `404`/`410` response means the browser's push service considers
    the subscription dead — that row is deleted automatically. Returns how
    many sends were attempted.
- **`NotificationsController` additions**:
  - `GET /notifications/vapid-public-key` → `{ publicKey }` (the frontend
    needs this to call `pushManager.subscribe`).
  - `POST /notifications/push-subscribe` → body `{ endpoint, keys: {
    p256dh, auth } }`, calls `saveSubscription` for the authenticated user.
  - `sendTest` now also calls `broadcastPush` and returns both counts —
    `devicesNotified` (existing, WebSocket-connected count) plus a new
    `pushDevicesNotified` (subscriptions attempted) — kept as two separate
    numbers since they measure different things and a device can show up in
    both.

### Frontend

- **`apps/web/public/sw.js`** gets two new listeners:
  - `push` — parses the JSON payload and calls
    `self.registration.showNotification(title, { body, icon, badge })`.
    This is what actually fires with the app fully closed — the browser
    wakes the service worker in its own background process for this.
  - `notificationclick` — closes the notification and focuses an existing
    OMS window/tab, or opens one if none exists.
- **New `apps/web/src/lib/push-subscription.ts`**: `subscribeToPush()` —
  feature-detects `'serviceWorker' in navigator && 'PushManager' in
  window`; if unsupported, returns a reason string (old iOS, or the PWA
  isn't installed to the Home Screen) instead of throwing. Otherwise: waits
  for `navigator.serviceWorker.ready`, requests Notification permission,
  fetches the VAPID public key from the server, subscribes via
  `pushManager.subscribe`, and POSTs the subscription to
  `/notifications/push-subscribe`.
- **`TestNotificationCard`**: the existing "Enable browser notifications"
  button becomes "Enable notifications" and calls `subscribeToPush()`
  instead of just `Notification.requestPermission()`. If push isn't
  supported, the card shows the reason (e.g. "Add OMS to your Home Screen
  first — push notifications need iOS 16.4 or later and an installed app")
  instead of a button that would silently fail.

## Edge cases

- **Subscription goes dead** (uninstalled, site data cleared, browser
  revokes it): the next `broadcastPush` gets a `404`/`410` for that
  endpoint and deletes the row — self-healing, no user action needed.
- **Multiple devices per user**: each gets its own `PushSubscription` row;
  `broadcastPush` sends to all rows regardless of which user owns them —
  same "broadcast to everyone signed in" scope as the existing WebSocket
  path.
- **Permission denied**: `subscribeToPush()` resolves with a clear failure
  reason; the card shows an error toast and the button stays available to
  retry (browsers require the user to change the permission in their own
  settings first, which this can't override).
- **Push not supported at all** (old iOS, or running in a plain Safari tab
  instead of the installed PWA): detected up front, shown as explanatory
  copy, no broken button.
- **Low Power Mode / Battery Saver**: explicitly not guaranteed — see Scope
  Decisions above. Not treated as a bug.

## Testing plan

Same convention as the rest of this project — no automated test runner
exists in this repo, so verification is manual:

1. Rebuild and restart via `restart.bat`.
2. On a desktop browser: enable notifications in Settings, then fully
   close the browser (not just the tab). Send a test notification from
   another device. Confirm a system notification appears with sound.
3. On a mobile device with OMS installed to the Home Screen: enable
   notifications, force-kill the app (swipe away from the app switcher),
   then send a test notification from another device. Confirm a
   notification arrives.
4. As a best-effort, non-blocking check: repeat step 3 with the phone in
   Low Power Mode / Battery Saver, and note what actually happens — this is
   observational, not a pass/fail requirement per the Scope Decisions above.
5. Confirm an intentionally-invalid/expired subscription gets cleaned up
   (its `PushSubscription` row disappears) after a broadcast attempt.

## Out of scope (explicitly deferred)

- A reusable "send this alert to this user/role" service for real business
  events (new order, dispatch ready, etc.) — this spec only wires up the
  test button.
- A manual unsubscribe/"disable notifications" control.
- Any guarantee of delivery under OS-level power-saving restrictions.
