# Push notifications for CRM followup reminders — design

Date: 2026-07-08

## Purpose

CRM followup reminders currently only work while a browser tab is open and
polling (`useFollowupDue`, every 60s) — chime, in-app banner, and an optional
foreground-only `Notification`. None of it reaches a device where the app is
backgrounded or killed. This spec connects followup reminders to the Web
Push infrastructure built for the test-notification feature (see
[2026-07-08-web-push-notifications-design.md](2026-07-08-web-push-notifications-design.md)),
so a followup becoming due can reach a killed/backgrounded phone, the same
way the test button already does.

## Scope decisions (confirmed with user)

- **Trigger must be server-side.** The existing client-poll pattern can't
  reach a closed app — nobody would be polling. This adds this codebase's
  first scheduled/cron job (`@nestjs/schedule`), checking every minute for
  followups that just became due.
- **Once per due-cycle**, not once per in-app reminder tick. A new
  `pushSentAt` column tracks this; it's cleared in the exact same three
  places `nextRemindAt` already gets reset today (re-promise, snooze,
  reopen), so a snoozed-then-due-again followup gets a fresh push, but the
  existing repeat-every-`intervalMins` in-app nudge does not also repeat
  the push.
- **No new settings UI.** The cron only pushes when the existing CRM
  `desktopNotifications` setting (Settings → Follow-up reminders) is on —
  the same toggle that already gates today's foreground `Notification`. It
  only reaches devices that separately subscribed via Settings → Test
  notifications → "Enable notifications" (shared subscription list, no
  CRM-specific opt-in).
- **Audience stays "everyone"** — `Followup` has no per-user assignment
  field (confirmed in `schema.prisma`), so this reuses the same
  broadcast-to-every-subscribed-device model as the test button, not new
  per-user targeting.
- **Deep link with auto-highlight.** The push carries `{ followupId, kind }`;
  clicking it opens `/crm?followup=<id>` (or `/crm/payments?followup=<id>`
  for `PAYMENT`-kind followups), and the page scrolls to and briefly
  highlights that card.

## Architecture

```
Every 60s: FollowupPushScheduler.tick()
    → reuses CrmService's existing "due" logic (computeFollowupState().isActiveNudge)
    → WHERE status = OPEN AND pushSentAt IS NULL AND is currently due
    → for each: NotificationsGateway.broadcast() + PushService.broadcastPush()
    → sets pushSentAt = now()
```

### Backend

- **New dependency**: `@nestjs/schedule`.
- **New Prisma column**: `Followup.pushSentAt DateTime?`. Reset to `null` in
  `CrmService.addLog` (re-promise branch), `CrmService.snooze`, and
  `CrmService.reopen` — the same three places `nextRemindAt` is already
  reset, so "once per cycle" tracks the exact same cycle boundary the
  in-app reminder already uses.
- **Generalizing the broadcast** (small, targeted refactor — two features
  now need the same send-to-everyone machinery):
  - `NotificationsGateway.broadcastTest(payload)` → `broadcastTest` stays
    for the existing test button; a new `broadcast(notification)` method
    is added taking `{ title: string; body: string; data?: Record<string,
    unknown> }` and emitting a generic `notification` event. The test
    button keeps using its own `test-notification` event/method
    unchanged — no need to touch working code — and the followup
    scheduler uses the new generic one. (Decided against renaming the
    existing method: it already has a verified client listener and
    payload shape; adding alongside is the smaller, safer diff.)
  - `PushService.broadcastPush(payload)` similarly gets a sibling
    `broadcastGeneric({ title, body, data })` that both the existing
    `payload` builder and the new scheduler can call — the actual
    `web-push` send + dead-subscription cleanup logic is shared, not
    duplicated.
- **New `FollowupPushScheduler`** (in the `crm` module): `@Interval(60_000)`
  method that:
  1. Reuses `CrmService`'s due-computation (a small new `dueUnpushed()`
     method on `CrmService`, mirroring `due()` but additionally filtering
     `pushSentAt === null`).
  2. Checks the CRM settings' `desktopNotifications` flag — skips entirely
     if off.
  3. For each due-and-unpushed followup: broadcasts (title `Follow-up:
     ${partyName}`, body matching what the in-app banner already shows)
     with `data: { followupId, kind }`, then sets `pushSentAt = now()` on
     that row.

### Frontend

- **`sw.js`**: the `push` handler passes `data` through to
  `showNotification`'s options; `notificationclick` reads
  `event.notification.data?.url` (computed server-side isn't possible, so
  the client-side handler builds it from `followupId`/`kind`) and
  navigates/focuses to `/crm?followup=<id>` or `/crm/payments?followup=<id>`
  instead of always `/`.
- **`FollowupsPage`**: reads the `?followup=` query param on mount, scrolls
  the matching card into view, and applies a brief highlight (a ring/glow
  class removed after ~2s).

## Edge cases

- **`desktopNotifications` off**: scheduler skips all followups, matching
  today's rule for the in-app foreground notification.
- **No push subscriptions at all**: `broadcastGeneric` simply attempts zero
  sends — same as today when nobody has enabled push yet.
- **Followup resolved between becoming due and the next tick**: the
  scheduler's query only considers `status: 'OPEN'`, so a resolved item is
  never pushed even if it briefly had `pushSentAt: null`.
- **Multiple followups due in the same tick**: each gets its own push (not
  batched into one) — matches how the in-app system already shows one
  banner per item.

## Testing plan

No automated test runner in this repo (same as prior specs). Manual
verification: create a followup with a promised date in the past (so it's
immediately due), confirm within ~60s a push arrives on a device with
notifications enabled and the app closed, and confirm clicking it opens
`/crm` scrolled to and highlighting that specific card. Then snooze it and
confirm a second push arrives once it becomes due again (proving the
per-cycle reset works), and confirm resolving it prevents any further push.

## Out of scope (explicitly deferred)

- Per-user targeting (no assignment field exists to target with).
- Any change to the existing in-app chime/banner behavior — this is purely
  additive.
- Applying this pattern to other event types (new order, dispatch) — each
  would need its own due-detection design.
