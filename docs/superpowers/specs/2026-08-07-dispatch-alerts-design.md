# Dispatch Alerts — design

**Date:** 2026-08-07
**Status:** Approved, ready for implementation plan

## Problem

Any user with `dispatch:create` can record a dispatch — or ship an entire order in one
click via "Create & Dispatch" — and nobody with oversight is told. Today the only
trace is the audit log, which nobody watches in real time.

Two paths in particular are completely ungated:

- **"Create & Dispatch"** (`POST /dispatch/fulfill-order/:orderId`) requires only
  `dispatch:create` and calls `dispatchOrderFully()`, which bypasses `submit()`
  entirely — no back-date gate, no approval, no notification. It stamps
  `dispatchDate: new Date()`, so the back-date rule can never trigger on it.
- A **normal dispatch dated today** also needs no approval. Approval only applies to a
  *back-dated* entry from the Dispatch form.

Owners/admins therefore have no live visibility into party items leaving the premises.

## Goal

Notify Super Admin, Admin, and anyone else explicitly granted the capability whenever a
user dispatches party items — with enough detail (party, item, design, quantity, status,
order, who did it) to judge it at a glance, delivered both in-app and to a phone with
the app closed.

## Non-goals

- **No persisted notification history / bell inbox.** Nothing is stored; alerts are
  transient (toast + OS push). Adding a history table is a separate project.
- No email or SMS delivery.
- No change to who is *allowed* to dispatch, or to any approval rule. This feature is
  observation only — it never blocks a dispatch.

## Architecture

### 1. Recipient rule — new `dispatchalert:notify` permission

A **new resource**, not a new action on the existing `dispatch` resource.

`hasPermission()` (`packages/shared/src/permissions.ts:331`) resolves
`<resource>:manage` as granting every action on that resource. Putting `notify` under
`dispatch` would mean Admin and Manager (both hold `dispatch:manage`) receive alerts
implicitly and **could never be excluded** without stripping their dispatch management.
A separate resource keeps the capability genuinely tick/untick-able per role, which is
the stated requirement.

Additions to `packages/shared/src/permissions.ts`:

- `ACTIONS.NOTIFY = 'notify'`
- `RESOURCES.DISPATCH_ALERT = 'dispatchalert'`
- `RESOURCE_DEFINITIONS` entry: label `Dispatch Alerts`, group `Sales`,
  actions `[ACTIONS.NOTIFY]`

Resulting permission key: **`dispatchalert:notify`**.

Who holds it:

| Role | Holds it |
| --- | --- |
| Super Admin | Automatically — `flattenAccess` grants the `*` wildcard (`apps/api/src/auth/user-access.util.ts:32`) |
| Admin | Added to the `admin` entry in `SYSTEM_ROLES` (affects fresh seeds); on the **live** database it must be ticked once on Roles & Permissions |
| Anyone else | Tick it on Roles & Permissions |

`dispatchalert:manage` is deliberately **not** in the catalog, so the `manage` fallback
in `hasPermission` cannot grant this accidentally.

Registration on the live database:

```
npm run db:seed:permissions -w @oms/api
```

This script only upserts the permission catalog. It does not re-hash the seed admin
password and does not alter role grants.

**Accepted consequence:** immediately after deploy, only Super Admin receives alerts
until `dispatchalert:notify` is ticked for Admin. This is the cost of the capability
being individually revocable, and was chosen knowingly.

Audience resolution reuses `NotificationAudienceService.userIdsWith('dispatchalert:notify')`
(`apps/api/src/notifications/notification-audience.service.ts:23`) — the same mechanism
CRM follow-up reminders already use. Only `status: 'active'` users are returned.

### 2. Trigger events

Five events, each independently switchable (see Settings, below).

| Event key | Hook site | Notes |
| --- | --- | --- |
| `onCreate` | inside `DispatchService.create()` | Guarded by `!row.deduped` |
| `onBulk` | `DispatchService.dispatchOrderFully()` | One grouped message per order |
| `onBackdateApproved` | `DISPATCH_BACKDATE` approval handler in `onModuleInit()` | Fires when the dispatch becomes real, not when requested |
| `onEdit` | `DispatchService.update()` | Only when `changes.length > 0` |
| `onDelete` | `DispatchService.remove()` | Reads the row before deleting it |

**The create hook must live inside `create()`, not at its callers.** `create()` merges a
duplicate submission within `DISPATCH_DEDUPE_WINDOW_MS` (15s) and returns the pre-existing
row (`apps/api/src/dispatch/dispatch.service.ts:740`). A hook at the caller would fire a
false alert on every double-tap, client retry, or concurrent save. The existing audit
block at `dispatch.service.ts:792` already demonstrates the correct guard.

`create()` is shared by the immediate path and the approval replay. It gains an optional
`opts.notifyEvent` so the replay can be reported as `onBackdateApproved` rather than
`onCreate`. The replay currently passes `skipAudit: true`; the notification guard is
`!row.deduped` alone and is independent of `skipAudit`.

### 3. Settings — "Dispatch Alerts" card

One `AppConfig` row, key `DISPATCH_ALERTS`, value a JSON object:

```json
{
  "enabled": false,
  "onCreate": false,
  "onBulk": false,
  "onBackdateApproved": false,
  "onEdit": false,
  "onDelete": false
}
```

**All flags default to `false`.** Nothing fires until explicitly enabled in Settings.
A missing or malformed `AppConfig` row resolves to all-false — the feature fails silent,
never fails loud.

`enabled` is a master switch: when false, no event fires regardless of the individual
flags.

`AppConfig` is the existing singleton key/value table (`schema.prisma:950`), already used
for `TCS_PERCENT`, `DISPATCH_BAG_THRESHOLD`, `DESIGN_TRACK_TYPES` and others. **No Prisma
migration is required.**

- API: `GET /settings/dispatch-alerts`, `PATCH /settings/dispatch-alerts`, following the
  existing `getDispatchBagThreshold` / `updateDispatchBagThreshold` pattern in
  `SettingsService`, including an explicit audit entry naming what changed.
  Guarded by `setting:view` / `setting:update` like its neighbours.
- Web: `dispatch-alerts-card.tsx` on the Settings page, matching the existing card
  structure (`design-track-card.tsx`), with a `canEdit` prop.

### 4. Message content

| Event | Title | Body |
| --- | --- | --- |
| Created | `Dispatch — {party}` | `{qty} · {status} · {product}{ · design} · {orderCode} · by {user}` |
| Bulk | `Full order dispatched — {party}` | `{orderCode} · {n} items · by {user}` |
| Back-date approved | `Back-dated dispatch approved — {party}` | `{qty} · dated {date} · {product} · requested by {requester}, approved by {approver}` |
| Edited | `Dispatch edited — {party}` | `{code} · {changes} · by {user}` |
| Deleted | `Dispatch deleted — {party}` | `{code} · {qty} · {product} · by {user}` |

Quantities are rendered with the existing `qtyText()` helper
(`dispatch.service.ts:32`), which prints only units carrying a value
("3 bags · 160 kgs"). Dates use the existing `formatDate()`. The edit body reuses the
`changes[]` array `update()` already assembles for the audit trail
(`dispatch.service.ts:1006`) — no second, divergent implementation of "what changed".

Payload `data`: `{ kind: 'dispatch', dispatchId?, dispatchCode?, orderId? }`.

### 5. Delivery

Both channels, reusing what already exists:

- **Live in-app** — `NotificationsGateway.notifyUsers()` (`notifications.gateway.ts:109`)
  emits `'notification'` to per-user Socket.IO rooms.
- **Web Push** — `PushService.sendToUsers()` (`push.service.ts:51`), which reaches a
  phone with the app fully closed and self-heals dead subscriptions.

Two existing client gaps must be closed for this to work at all:

1. **`apps/web/src/lib/notifications-socket.ts` does not listen for `'notification'`.**
   It handles only `test-notification`, `challans:pending-changed` and
   `auth:signed-out`. Without a new listener, in-app toasts are silently dead. Add a
   handler that shows a `sonner` toast and a native `Notification` when permitted.
2. **`apps/web/public/sw.js:136` routes `notificationclick` only for `followupId`.**
   A dispatch alert would land on `/`. Extend it to route `kind === 'dispatch'` to the
   Modify Dispatch page (`/dispatch`, `router.tsx:330`), falling back to `/`.
   `CACHE` must be bumped from `oms-v11` to `oms-v12` so browsers adopt the new worker.

### 6. Self-exclusion

The acting user is always removed from the recipient list — nobody is alerted about
their own action, on any of the five paths.

This requires the actor's **user id** (not just the name) at each hook:

- `create()` already receives `actor?: Actor` carrying `id`.
- `dispatchOrderFully(orderId, userName)` — signature widens to accept the actor.
  Its only caller is `DispatchController.fulfillOrder`, which has `@CurrentUser()`
  available.
- `remove(id)` — same, widens to accept the actor from the controller.
- The approval path: `ApprovalHandler` is
  `(payload, approverName: string) => Promise<number | null>`
  (`approvals.service.ts:25`) and carries no approver id. It gains an **optional third
  parameter** `approver?: { id?: string | null; name: string }`, supplied by
  `approve()`, which already holds exactly that object (`approvals.service.ts:165`).
  Optional means every existing handler compiles and behaves unchanged.

For the approved back-date, the excluded actor is the **approver** (they just signed it
off and know). The original requester is named in the message body but is not excluded —
other admins, including the requester if they hold the permission, still get told.

### 7. Component boundaries

A new `DispatchNotifier` service in `apps/api/src/dispatch/dispatch-notifier.service.ts`
owns everything about alerting. `DispatchService` calls it and knows nothing about
sockets, push, permissions, or settings.

- **What it does:** given an event kind and its facts, decide whether the event is
  enabled, resolve the audience, compose the message, and send on both channels.
- **How it is used:** five fire-and-forget methods —
  `dispatchCreated`, `orderFullyDispatched`, `backdateApproved`, `dispatchUpdated`,
  `dispatchDeleted`.
- **What it depends on:** `SettingsService` (flags), `NotificationAudienceService`
  (recipients), `NotificationsGateway` and `PushService` (delivery).

`DispatchModule` gains `imports: [NotificationsModule, SettingsModule]`. Neither imports
`DispatchModule`, so there is no cycle; `ChallansModule` already imports this exact pair.

This keeps `dispatch.service.ts` — already ~1250 lines — from absorbing another
responsibility, and makes the alerting logic testable and readable on its own.

### 8. Error handling — the invariant

**A notification failure must never fail, slow, or roll back a dispatch.**

- Every notifier call site is `void`-ed, never `await`-ed by the dispatch flow.
- Every notifier method wraps its whole body in `try/catch` and logs a warning on
  failure via NestJS `Logger` — it never rethrows.
- No notifier call happens inside a Prisma transaction. `create()` sends only after
  `$transaction` has committed and `ensureCode()` has run.
- An empty audience sends nothing. `PushService.sendToUsers` already returns `0` on an
  empty list rather than falling back to broadcast (`push.service.ts:55`) — "nobody is
  allowed" must never become "tell everyone".
- Malformed or missing `DISPATCH_ALERTS` config resolves to all-off.

This mirrors the guard already used in `followup-push.scheduler.ts:27`, where an
unhandled rejection inside a `setInterval` would crash the process.

## Testing

The repository has **no test files and no test runner** — `npm run lint -w @oms/api` is
`tsc --noEmit`. Verification is therefore compile plus a real run, and results will be
reported as observed, not assumed.

1. `npm run build:shared` then `npm run lint` for both `@oms/api` and `@oms/web` — must
   compile clean.
2. `npm run db:seed:permissions -w @oms/api` — confirm the output reports
   `1 newly added` and that no permission is pruned.
3. Confirm `dispatchalert:notify` appears under Sales → Dispatch Alerts on the Roles &
   Permissions screen and can be ticked and unticked.
4. With every flag off (the shipped default): record a dispatch and confirm **no**
   alert fires and the dispatch itself saves normally.
5. Enable `onCreate`: dispatch as a non-admin, confirm the Super Admin's open tab
   toasts with correct party/item/qty/status text, and that the dispatching user
   receives nothing.
6. Enable `onBulk`: run "Create & Dispatch" on a multi-line order and confirm exactly
   **one** grouped alert, not one per line.
7. Double-tap Save on the Dispatch form within 15s and confirm exactly **one** alert
   (the dedupe guard).
8. Enable `onEdit` / `onDelete` and confirm the before→after text matches what the
   dispatch's own Activity History records.
9. Confirm a dispatch still saves when the socket server is unreachable.

## Risks

| Risk | Mitigation |
| --- | --- |
| Admin gets no alerts after deploy | Documented; one tick on the Roles screen. Called out explicitly at handover. |
| Stale service worker ignores the new click route | `CACHE` bumped to `oms-v12`, which forces eviction on activate. |
| Alert noise on a busy dispatch day | All flags ship off; each is independently switchable. |
| A dispatch fails because of alerting | Section 8 invariant — fire-and-forget, caught, outside the transaction. |
