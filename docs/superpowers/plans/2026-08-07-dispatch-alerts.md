# Dispatch Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alert every user holding `dispatchalert:notify` — in-app and via Web Push — whenever another user dispatches party items, with party/item/quantity/status detail.

**Architecture:** A new `DispatchNotifier` service owns all alerting; `DispatchService` calls it with plain facts and knows nothing about sockets, push, permissions, or settings. Five hook sites cover every path a dispatch can take. Per-event on/off flags live in one JSON row of the existing `AppConfig` key/value table, so there is **no Prisma migration**.

**Tech Stack:** NestJS + Prisma (SQLite) API, React + TanStack Query + Tailwind web, Socket.IO, `web-push`, shared types in `@oms/shared`.

## Global Constraints

- **No Prisma migration.** Settings live in the existing `AppConfig` singleton key/value table (`apps/api/prisma/schema.prisma:950`). Do not add a model.
- **No new npm dependencies.**
- **All five event flags plus the master switch ship `false`.** Nothing fires until enabled in Settings.
- **Alerting must never fail, slow, or roll back a dispatch.** Every notifier method returns `void`, catches everything internally, is never `await`-ed by the dispatch flow, and is never called inside a Prisma transaction.
- **Permission key is exactly `dispatchalert:notify`.** Never add `dispatchalert:manage` to the catalog — `hasPermission()` would then grant alerts implicitly (`packages/shared/src/permissions.ts:331`).
- **Empty audience sends nothing.** Never fall back to broadcast.
- **The repository has no test runner.** `npm run lint -w @oms/api` and `npm run lint -w @oms/web` are both `tsc --noEmit`. Verification is compile + a real run against the app. Do not add a test framework. Report what you actually observe — if a check is skipped or fails, say so.
- Match surrounding code style: 2-space indent, single quotes, comments that explain *why*.

## File Structure

**Create:**
| File | Responsibility |
| --- | --- |
| `apps/api/src/dispatch/qty-text.util.ts` | `qtyText()`, extracted so both the service and the notifier use one implementation |
| `apps/api/src/dispatch/dispatch-notifier.service.ts` | All alerting: flag check, audience, message composition, dual-channel send |
| `apps/api/src/settings/dto/dispatch-alerts.dto.ts` | Validation for the settings PUT body |
| `apps/web/src/features/settings/dispatch-alerts-card.tsx` | The Settings card with the master switch + 5 checkboxes |

**Modify:**
| File | Change |
| --- | --- |
| `packages/shared/src/permissions.ts` | `ACTIONS.NOTIFY`, `RESOURCES.DISPATCH_ALERT`, catalog entry |
| `packages/shared/src/roles.ts` | grant it to the `admin` system role |
| `packages/shared/src/types/setting.ts` | `DispatchAlertSettingsDto` / `Input` / `DispatchAlertEvent` |
| `packages/shared/src/types/notification.ts` | `AppNotification` |
| `apps/api/src/settings/settings.service.ts` | `getDispatchAlerts` / `updateDispatchAlerts` |
| `apps/api/src/settings/settings.controller.ts` | `GET` / `PUT /settings/dispatch-alerts` |
| `apps/api/src/approvals/approvals.service.ts` | optional 3rd handler param carrying the approver |
| `apps/api/src/dispatch/dispatch.module.ts` | import Notifications + Settings, provide the notifier |
| `apps/api/src/dispatch/dispatch.service.ts` | 5 hook sites + signature widening |
| `apps/api/src/dispatch/dispatch.controller.ts` | pass the actor to `fulfillOrder` and `remove` |
| `apps/web/src/lib/notifications-socket.ts` | the missing `'notification'` listener |
| `apps/web/public/sw.js` | route `kind === 'dispatch'`, bump `CACHE` |
| `apps/web/src/features/settings/use-settings.ts` | query + mutation hooks |
| `apps/web/src/features/settings/settings-page.tsx` | mount the card on the Dispatch tab |

---

### Task 1: Shared contract — permission, roles, types

**Files:**
- Modify: `packages/shared/src/permissions.ts:36`, `:97`, `:290`
- Modify: `packages/shared/src/roles.ts:56`
- Modify: `packages/shared/src/types/setting.ts` (append)
- Modify: `packages/shared/src/types/notification.ts` (append)

**Interfaces:**
- Produces: `ACTIONS.NOTIFY`, `RESOURCES.DISPATCH_ALERT`, permission key `dispatchalert:notify`, `DispatchAlertSettingsDto`, `DispatchAlertSettingsInput`, `DispatchAlertEvent`, `AppNotification`. Every later task consumes these.

- [ ] **Step 1: Add the `notify` action**

In `packages/shared/src/permissions.ts`, inside the `ACTIONS` object, immediately **before** the `MANAGE` entry:

```ts
  /** Receives alerts for a feature area. Delivery only — grants no access to any
   *  screen or data, so it can be given to (and taken from) a role on its own. */
  NOTIFY: 'notify',
```

- [ ] **Step 2: Add the `dispatchalert` resource**

In the same file, inside `RESOURCES`, immediately **after** the `DISPATCH` entry:

```ts
  /** Dispatch alerts: who is told when a user dispatches party items. Deliberately
   *  its OWN resource rather than a `dispatch:notify` action — `hasPermission`
   *  treats `<resource>:manage` as granting every action on that resource, so
   *  under `dispatch` everyone holding `dispatch:manage` would receive alerts
   *  implicitly and could never be excluded. */
  DISPATCH_ALERT: 'dispatchalert',
```

- [ ] **Step 3: Add the catalog entry**

In `RESOURCE_DEFINITIONS`, immediately **after** the `RESOURCES.CHALLAN` entry:

```ts
  {
    resource: RESOURCES.DISPATCH_ALERT,
    label: 'Dispatch Alerts',
    group: 'Sales',
    // NOTE: `manage` is deliberately absent. Adding it would let the
    // `<resource>:manage` fallback in hasPermission() grant alerts implicitly.
    actions: [ACTIONS.NOTIFY],
  },
```

- [ ] **Step 4: Grant it to the admin system role**

In `packages/shared/src/roles.ts`, in the `admin` role's `permissions` array, after the `APPROVAL` line:

```ts
      // Told whenever anyone dispatches party items. Its own resource, so it can
      // be revoked from this role without touching dispatch management.
      perm(RESOURCES.DISPATCH_ALERT, ACTIONS.NOTIFY),
```

This affects fresh seeds only. On the live database it must be ticked once on the Roles screen (Task 7).

- [ ] **Step 5: Add the settings types**

Append to `packages/shared/src/types/setting.ts`:

```ts
/** Which dispatch events raise an alert to users holding `dispatchalert:notify`.
 *  Every flag ships false — the feature does nothing until switched on. */
export interface DispatchAlertSettingsDto {
  /** Master switch. When false nothing fires, whatever the individual flags say. */
  enabled: boolean;
  /** A dispatch recorded from the Dispatch form. */
  onCreate: boolean;
  /** "Create & Dispatch" shipped a whole order — one grouped alert, not one per line. */
  onBulk: boolean;
  /** A back-dated dispatch became real because an approver signed it off. */
  onBackdateApproved: boolean;
  /** An existing dispatch's qty / status / date / remark changed. */
  onEdit: boolean;
  /** A dispatch was deleted. */
  onDelete: boolean;
}

export type DispatchAlertSettingsInput = DispatchAlertSettingsDto;

/** The per-event keys of {@link DispatchAlertSettingsDto} — everything except the
 *  master switch. Used to index the flags when deciding whether to send. */
export type DispatchAlertEvent = 'onCreate' | 'onBulk' | 'onBackdateApproved' | 'onEdit' | 'onDelete';
```

- [ ] **Step 6: Add the notification payload type**

Append to `packages/shared/src/types/notification.ts`:

```ts
/** A notification addressed to specific users: the body of the Socket.IO
 *  `notification` event and of the Web Push message. */
export interface AppNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}
```

- [ ] **Step 7: Build shared and verify it compiles**

Run: `npm run build:shared`
Expected: exits 0, no TypeScript errors. `packages/shared/dist/` is refreshed — every later task imports from the built output, so this build must run before the API or web compile.

- [ ] **Step 8: Verify the permission key is in the catalog**

Run:
```bash
node -e "const s=require('./packages/shared/dist/cjs/index.js');console.log(s.ALL_PERMISSION_KEYS.filter(k=>k.startsWith('dispatchalert')))"
```
Expected: `[ 'dispatchalert:notify' ]` — exactly one key, and **not** `dispatchalert:manage`.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): dispatchalert:notify permission + dispatch alert types"
```

---

### Task 2: Settings API — read/write the alert flags

**Files:**
- Create: `apps/api/src/settings/dto/dispatch-alerts.dto.ts`
- Modify: `apps/api/src/settings/settings.service.ts:27` (constants), append a section after `updateDispatchBagThreshold`
- Modify: `apps/api/src/settings/settings.controller.ts:119` (after the bag-threshold routes)

**Interfaces:**
- Consumes: `DispatchAlertSettingsDto` (Task 1).
- Produces: `SettingsService.getDispatchAlerts(): Promise<DispatchAlertSettingsDto>` and `SettingsService.updateDispatchAlerts(dto, actor?): Promise<DispatchAlertSettingsDto>`. Task 3 calls `getDispatchAlerts`; Task 6 calls both over HTTP.

- [ ] **Step 1: Create the DTO**

Create `apps/api/src/settings/dto/dispatch-alerts.dto.ts`:

```ts
import { IsBoolean } from 'class-validator';

/** Every flag is required and must be a real boolean — the card always sends the
 *  complete object, so a partial body is a bug worth rejecting rather than
 *  silently merging into whatever was stored before. */
export class UpdateDispatchAlertsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  onCreate!: boolean;

  @IsBoolean()
  onBulk!: boolean;

  @IsBoolean()
  onBackdateApproved!: boolean;

  @IsBoolean()
  onEdit!: boolean;

  @IsBoolean()
  onDelete!: boolean;
}
```

- [ ] **Step 2: Add the config key and the all-off default**

In `apps/api/src/settings/settings.service.ts`, after the `DISPATCH_BAG_THRESHOLD` constant (line 27):

```ts
const DISPATCH_ALERTS = 'DISPATCH_ALERTS';
```

And after the `DEFAULT_CHALLAN_TERMS` constant (line 41):

```ts
// Ships entirely off: the business turns on exactly the events it wants. Also the
// resolved value for a missing or malformed config row — alerting fails silent,
// never loud, and must never start firing because a row could not be parsed.
const DISPATCH_ALERTS_OFF: DispatchAlertSettingsDto = {
  enabled: false,
  onCreate: false,
  onBulk: false,
  onBackdateApproved: false,
  onEdit: false,
  onDelete: false,
};
```

Add `type DispatchAlertSettingsDto` to the existing `@oms/shared` import at line 3.

- [ ] **Step 3: Add the service methods**

In `apps/api/src/settings/settings.service.ts`, after `updateDispatchBagThreshold` (ends line 245):

```ts
  /* ── Dispatch alerts (who gets told when party items are dispatched) ───────
   * One JSON row in AppConfig, so there is no schema to migrate. Reads coerce
   * every flag with `=== true`: a partial, mistyped or hand-edited row resolves
   * to off rather than to an accidental broadcast. */

  async getDispatchAlerts(): Promise<DispatchAlertSettingsDto> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: DISPATCH_ALERTS } });
    if (!row?.value) return { ...DISPATCH_ALERTS_OFF };
    try {
      const parsed = JSON.parse(row.value) as Partial<DispatchAlertSettingsDto>;
      const on = (k: keyof DispatchAlertSettingsDto) => parsed[k] === true;
      return {
        enabled: on('enabled'),
        onCreate: on('onCreate'),
        onBulk: on('onBulk'),
        onBackdateApproved: on('onBackdateApproved'),
        onEdit: on('onEdit'),
        onDelete: on('onDelete'),
      };
    } catch {
      return { ...DISPATCH_ALERTS_OFF };
    }
  }

  async updateDispatchAlerts(
    dto: UpdateDispatchAlertsDto,
    actor?: AuthenticatedUser,
  ): Promise<DispatchAlertSettingsDto> {
    const before = await this.getDispatchAlerts();
    const after: DispatchAlertSettingsDto = {
      enabled: dto.enabled,
      onCreate: dto.onCreate,
      onBulk: dto.onBulk,
      onBackdateApproved: dto.onBackdateApproved,
      onEdit: dto.onEdit,
      onDelete: dto.onDelete,
    };
    const value = JSON.stringify(after);
    await this.prisma.appConfig.upsert({
      where: { key: DISPATCH_ALERTS },
      update: { value },
      create: { key: DISPATCH_ALERTS, value },
    });

    // Name each flag that actually moved — "Updated settings" would not answer
    // "who turned dispatch alerts off, and when", which is the whole point of
    // auditing a switch like this.
    const keys = Object.keys(after) as (keyof DispatchAlertSettingsDto)[];
    const changed = keys
      .filter((k) => before[k] !== after[k])
      .map((k) => `${k} ${before[k] ? 'on' : 'off'} → ${after[k] ? 'on' : 'off'}`);
    void this.audit.record({
      userId: actor?.id ?? null,
      userEmail: actor?.email ?? null,
      action: ACTIONS.UPDATE,
      resource: RESOURCES.SETTING,
      resourceId: DISPATCH_ALERTS,
      description: changed.length
        ? `Changed dispatch alerts: ${changed.join('; ')}`
        : 'Saved dispatch alerts (no change)',
      statusCode: 200,
      metadata: { before, after },
    });
    return after;
  }
```

Add the import at the top of the file, next to the other DTO imports:

```ts
import { UpdateDispatchAlertsDto } from './dto/dispatch-alerts.dto';
```

- [ ] **Step 4: Add the routes**

In `apps/api/src/settings/settings.controller.ts`, after `updateDispatchBagThreshold` (ends line 119):

```ts
  // Dispatch alerts — readable by any authenticated user (the card renders for
  // anyone who can open Settings), editable only with setting:update. The service
  // writes its own audit entry naming each flag that moved.
  @Get('dispatch-alerts')
  getDispatchAlerts() {
    return this.settings.getDispatchAlerts();
  }

  @Put('dispatch-alerts')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @SkipAudit()
  updateDispatchAlerts(@Body() dto: UpdateDispatchAlertsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.updateDispatchAlerts(dto, user);
  }
```

Add the import next to the other DTO imports:

```ts
import { UpdateDispatchAlertsDto } from './dto/dispatch-alerts.dto';
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run lint -w @oms/api`
Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/settings
git commit -m "feat(api): dispatch alert settings, stored in AppConfig"
```

---

### Task 3: The `DispatchNotifier` service

**Files:**
- Create: `apps/api/src/dispatch/qty-text.util.ts`
- Create: `apps/api/src/dispatch/dispatch-notifier.service.ts`
- Modify: `apps/api/src/dispatch/dispatch.service.ts:31-40` (remove the local `qtyText`, import it instead)
- Modify: `apps/api/src/dispatch/dispatch.module.ts`

**Interfaces:**
- Consumes: `SettingsService.getDispatchAlerts()` (Task 2); `NotificationAudienceService.userIdsWith()`, `NotificationsGateway.notifyUsers()`, `PushService.sendToUsers()` (all pre-existing); `DispatchAlertEvent`, `AppNotification` (Task 1).
- Produces: `qtyText(q)` from `./qty-text.util`, and `DispatchNotifier` with five `void`-returning methods — `dispatchCreated`, `orderFullyDispatched`, `backdateApproved`, `dispatchUpdated`, `dispatchDeleted` — whose exact input shapes are defined below. Task 4 calls all five.

- [ ] **Step 1: Extract `qtyText` into its own module**

Create `apps/api/src/dispatch/qty-text.util.ts`:

```ts
/** "3 bags · 160 kgs" — only the units that carry a value, so the text stays
 *  readable. Shared by the audit trail and the dispatch alerts so the two can
 *  never describe the same shipment differently. */
export function qtyText(q: {
  bags?: number | null;
  pcs?: number | null;
  gram?: number | null;
  box?: number | null;
}): string {
  const parts = [
    q.bags ? `${q.bags} bags` : null,
    q.pcs ? `${q.pcs} pcs` : null,
    q.gram ? `${q.gram} kgs` : null,
    q.box ? `${q.box} box` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no quantities';
}
```

Then in `apps/api/src/dispatch/dispatch.service.ts`, **delete** the local `qtyText` function (lines 31-40, including its comment) and add to the imports:

```ts
import { qtyText } from './qty-text.util';
```

The notifier must not import from `dispatch.service.ts` — `dispatch.service.ts` will import the notifier for DI, and a mutual file import risks a circular-import failure at module load.

- [ ] **Step 2: Create the notifier**

Create `apps/api/src/dispatch/dispatch-notifier.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ACTIONS, perm, RESOURCES, type AppNotification, type DispatchAlertEvent } from '@oms/shared';
import { formatDate } from '../common/date.util';
import { NotificationAudienceService } from '../notifications/notification-audience.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PushService } from '../notifications/push.service';
import { SettingsService } from '../settings/settings.service';
import { qtyText } from './qty-text.util';

/** Quantities as they sit on a Dispatch row. */
interface Qty {
  bags?: number | null;
  pcs?: number | null;
  gram?: number | null;
  box?: number | null;
}

/** Who performed the action. `actorId` is excluded from the audience — nobody is
 *  told about their own dispatch. */
interface Actor {
  actorId?: string | null;
  userName?: string | null;
}

/**
 * Tells the people who watch dispatches that party items just moved.
 *
 * Everything about alerting lives here: whether the event is switched on, who is
 * allowed to hear about it, how the message reads, and which channels carry it.
 * DispatchService hands over plain facts and knows nothing about sockets, push,
 * permissions or settings.
 *
 * Every method returns void and swallows its own failures. A dead push endpoint,
 * an unreachable socket server or an unreadable config row must never fail, slow
 * or roll back the dispatch that triggered it — the shipment is the real work,
 * the alert is commentary.
 */
@Injectable()
export class DispatchNotifier {
  private readonly logger = new Logger(DispatchNotifier.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly audience: NotificationAudienceService,
    private readonly gateway: NotificationsGateway,
    private readonly push: PushService,
  ) {}

  /** A dispatch was recorded from the Dispatch form. */
  dispatchCreated(
    f: Actor & Qty & {
      dispatchId: number;
      dispatchCode: string;
      customerName: string;
      productName?: string | null;
      designType?: string | null;
      orderCode?: string | null;
      dispatchStatus: string;
    },
  ): void {
    this.fire('onCreate', f.actorId, {
      title: `Dispatch — ${f.customerName}`,
      body: this.line([
        qtyText(f),
        f.dispatchStatus,
        this.itemText(f.productName, f.designType),
        f.orderCode,
        this.by(f.userName),
      ]),
      data: { kind: 'dispatch', dispatchId: f.dispatchId, dispatchCode: f.dispatchCode },
    });
  }

  /** "Create & Dispatch" shipped a whole order — ONE alert, not one per line. */
  orderFullyDispatched(
    f: Actor & { orderId: number; orderCode: string; customerName: string; itemCount: number },
  ): void {
    this.fire('onBulk', f.actorId, {
      title: `Full order dispatched — ${f.customerName}`,
      body: this.line([
        f.orderCode,
        `${f.itemCount} ${f.itemCount === 1 ? 'item' : 'items'}`,
        this.by(f.userName),
      ]),
      data: { kind: 'dispatch', orderId: f.orderId },
    });
  }

  /** A back-dated dispatch became real because an approver signed it off. The
   *  excluded actor is the APPROVER — they just decided it and know. The original
   *  requester is named in the body but still hears about it. */
  backdateApproved(
    f: Actor & Qty & {
      dispatchId: number;
      dispatchCode: string;
      customerName: string;
      productName?: string | null;
      orderCode?: string | null;
      dispatchDate: string;
      requestedByName?: string | null;
      approverName: string;
    },
  ): void {
    this.fire('onBackdateApproved', f.actorId, {
      title: `Back-dated dispatch approved — ${f.customerName}`,
      body: this.line([
        qtyText(f),
        `dated ${formatDate(f.dispatchDate)}`,
        f.productName,
        f.orderCode,
        `requested by ${f.requestedByName ?? 'someone'}, approved by ${f.approverName}`,
      ]),
      data: { kind: 'dispatch', dispatchId: f.dispatchId, dispatchCode: f.dispatchCode },
    });
  }

  /** An existing dispatch changed. `changes` is the same before → after text the
   *  dispatch's own Activity History shows, so the two can never disagree. */
  dispatchUpdated(
    f: Actor & { dispatchId: number; dispatchCode: string; customerName: string; changes: string },
  ): void {
    this.fire('onEdit', f.actorId, {
      title: `Dispatch edited — ${f.customerName}`,
      body: this.line([f.dispatchCode, f.changes, this.by(f.userName)]),
      data: { kind: 'dispatch', dispatchId: f.dispatchId, dispatchCode: f.dispatchCode },
    });
  }

  /** A dispatch was deleted. Carries the quantities it held, since the row is gone. */
  dispatchDeleted(
    f: Actor & Qty & {
      dispatchCode: string;
      customerName: string;
      productName?: string | null;
    },
  ): void {
    this.fire('onDelete', f.actorId, {
      title: `Dispatch deleted — ${f.customerName}`,
      body: this.line([f.dispatchCode, qtyText(f), f.productName, this.by(f.userName)]),
      data: { kind: 'dispatch' },
    });
  }

  /* ── internals ──────────────────────────────────────────────────────────── */

  /** Join the parts that carry a value with " · ", so an absent order code or
   *  design never leaves a dangling separator in the message. */
  private line(parts: (string | null | undefined)[]): string {
    return parts.map((p) => p?.trim()).filter(Boolean).join(' · ');
  }

  private by(userName?: string | null): string | null {
    return userName ? `by ${userName}` : null;
  }

  /** "10 RDX WL+LOGO" — the design is appended only when it is a real one.
   *  Imported lines store the literal string "NA", which is noise in an alert. */
  private itemText(productName?: string | null, designType?: string | null): string | null {
    const product = productName?.trim() || null;
    const design = designType?.trim();
    const realDesign = design && design.toUpperCase() !== 'NA' ? design : null;
    if (!product) return realDesign;
    return realDesign ? `${product} ${realDesign}` : product;
  }

  /**
   * Send, if this event is switched on and anyone is listening.
   *
   * Fire-and-forget on purpose: the caller gets control back immediately and can
   * never be blocked, slowed or failed by delivery. The whole body is guarded —
   * the promise is not awaited by anyone, so an escaping rejection would surface
   * as an unhandled rejection rather than a caller-visible error.
   */
  private fire(event: DispatchAlertEvent, actorId: string | null | undefined, notification: AppNotification): void {
    void (async () => {
      try {
        const flags = await this.settings.getDispatchAlerts();
        if (!flags.enabled || !flags[event]) return;

        const all = await this.audience.userIdsWith(perm(RESOURCES.DISPATCH_ALERT, ACTIONS.NOTIFY));
        // Nobody is told about their own action.
        const recipients = actorId ? all.filter((id) => id !== actorId) : all;
        // An empty audience sends NOTHING. "Nobody is allowed" must never become
        // "tell everyone" — a push notification outlives the session that made it.
        if (!recipients.length) return;

        this.gateway.notifyUsers(recipients, notification);
        await this.push.sendToUsers(recipients, notification);
      } catch (err) {
        this.logger.warn(`Dispatch alert (${event}) failed: ${(err as Error).message}`);
      }
    })();
  }
}
```

- [ ] **Step 3: Wire the module**

Replace `apps/api/src/dispatch/dispatch.module.ts` entirely:

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { DispatchController } from './dispatch.controller';
import { DispatchNotifier } from './dispatch-notifier.service';
import { DispatchService } from './dispatch.service';

@Module({
  // NotificationsModule → gateway + push + audience for dispatch alerts;
  // SettingsModule → the per-event on/off flags. Neither imports DispatchModule,
  // so there is no cycle (ChallansModule already imports this same pair).
  imports: [NotificationsModule, SettingsModule],
  controllers: [DispatchController],
  providers: [DispatchService, DispatchNotifier],
  // Design Track reads the same pending pool (DispatchService.pendingPool).
  exports: [DispatchService],
})
export class DispatchModule {}
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint -w @oms/api`
Expected: exits 0. If `qtyText` is reported as undefined in `dispatch.service.ts`, the import from Step 1 is missing.

- [ ] **Step 5: Verify the app still boots with the new provider**

Run: `npm run dev:api -w @oms/api` (or `npm run dev:api` from the root), wait for `Nest application successfully started`, then stop it.
Expected: starts clean. A `Nest can't resolve dependencies of the DispatchNotifier` error here means Step 3's `imports` are wrong. This is the one place a DI mistake surfaces, so do not skip it.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/dispatch
git commit -m "feat(api): DispatchNotifier — alerting isolated from DispatchService"
```

---

### Task 4: Hook the five dispatch paths

**Files:**
- Modify: `apps/api/src/approvals/approvals.service.ts:25`, `:183`
- Modify: `apps/api/src/dispatch/dispatch.service.ts` — constructor, `onModuleInit`, `create`, `dispatchOrderFully`, `update`, `remove`
- Modify: `apps/api/src/dispatch/dispatch.controller.ts:154`, `:173`

**Interfaces:**
- Consumes: all five `DispatchNotifier` methods (Task 3).
- Produces: `DispatchService.dispatchOrderFully(orderId, actor?)` and `DispatchService.remove(id, actor?)` — both signatures widen; `ApprovalHandler` gains an optional third parameter.

- [ ] **Step 1: Give approval handlers the approver's identity**

In `apps/api/src/approvals/approvals.service.ts`, replace the `ApprovalHandler` type (line 25):

```ts
/** Applies an approved request. `approver` is optional so handlers that don't
 *  care about who signed off keep compiling unchanged. */
export type ApprovalHandler = (
  payload: Record<string, unknown>,
  approverName: string,
  approver?: { id?: string | null; name: string },
) => Promise<number | null>;
```

And in `approve()`, replace the handler call (line 183):

```ts
    const resultId = await handler(payload, approver.name, approver);
```

`approve()` already receives `approver: { id?: string | null; name: string }` — nothing else changes.

- [ ] **Step 2: Inject the notifier into `DispatchService`**

In `apps/api/src/dispatch/dispatch.service.ts`, add to the imports:

```ts
import { DispatchNotifier } from './dispatch-notifier.service';
```

and add the constructor parameter (after `audit`):

```ts
    private readonly notifier: DispatchNotifier,
```

- [ ] **Step 3: Hook `create()` — inside, past the dedupe guard**

In `create()`, replace the existing `opts` parameter type in the signature:

```ts
  async create(
    dto: CreateDispatchDto,
    userName?: string,
    actor?: Actor,
    opts?: { skipAudit?: boolean; skipNotify?: boolean },
  ): Promise<DispatchDto> {
```

Then, immediately **after** the closing brace of the existing `if (!row.deduped && !opts?.skipAudit) { ... }` block and **before** `this.invalidatePendingCache();`:

```ts
    // Alert AFTER the transaction has committed, and only for a real insert.
    // A deduped double-tap returns the pre-existing row (see
    // DISPATCH_DEDUPE_WINDOW_MS) — alerting there would fire a second time for a
    // shipment that only ever happened once. `skipNotify` is the approval replay,
    // which raises its own, differently-worded alert instead.
    if (!row.deduped && !opts?.skipNotify) {
      this.notifier.dispatchCreated({
        actorId: actor?.id ?? null,
        userName: userName ?? actor?.name ?? null,
        dispatchId: dispatch.id,
        dispatchCode: dispatch.code ?? this.codeFor(dispatch.id),
        customerName: dispatch.customerName,
        productName: dispatch.productName,
        designType: dispatch.designType,
        orderCode: dispatch.orderCode,
        dispatchStatus: dto.dispatchStatus,
        bags,
        pcs,
        gram,
        box,
      });
    }
```

- [ ] **Step 4: Hook the approved back-date**

In `onModuleInit()`, replace the whole `registerHandler('DISPATCH_BACKDATE', ...)` call with:

```ts
    this.approvals.registerHandler('DISPATCH_BACKDATE', async (payload, approverName, approver) => {
      const p = payload as unknown as DispatchBackdatePayload;
      const row = await this.create(
        {
          orderItemId: p.orderItemId,
          dispatchStatus: p.dispatchStatus as CreateDispatchDto['dispatchStatus'],
          bags: p.bags ?? undefined,
          pcs: p.pcs ?? undefined,
          gram: p.gram ?? undefined,
          box: p.box ?? undefined,
          comment: p.comment ?? undefined,
          supItem: p.supItem ?? undefined,
          dispatchDate: p.dispatchDate,
        },
        // Keep the ORIGINAL requester on the record — the approver's name belongs
        // on the approval row, not on the dispatch they merely signed off.
        p.requestedByName ?? approverName,
        undefined,
        // ApprovalsService.approve() writes the combined audit entry, and the
        // alert below says "approved" rather than the plain "dispatched" one
        // create() would have raised.
        { skipAudit: true, skipNotify: true },
      );
      this.notifier.backdateApproved({
        // The approver is excluded — they just decided this and know about it.
        actorId: approver?.id ?? null,
        dispatchId: row.id,
        dispatchCode: row.code,
        customerName: p.customerName,
        productName: p.productName,
        orderCode: p.orderCode,
        dispatchDate: p.dispatchDate,
        requestedByName: p.requestedByName ?? null,
        approverName,
        bags: p.bags,
        pcs: p.pcs,
        gram: p.gram,
        box: p.box,
      });
      return row.id;
    });
```

`DispatchBackdatePayload` already carries `customerName`, `orderCode`, `productName` and `requestedByName` — `submit()` populates them (`dispatch.service.ts:671`).

- [ ] **Step 5: Hook "Create & Dispatch"**

Change the signature of `dispatchOrderFully`:

```ts
  async dispatchOrderFully(orderId: number, actor?: Actor): Promise<{ dispatched: number; skipped: number }> {
```

Inside the transaction's `tx.dispatch.create({ data: { ... } })`, replace the `userName` line:

```ts
            userName: actor?.name ?? null,
```

And replace the closing lines of the method:

```ts
    if (result.dispatched > 0) {
      this.invalidatePendingCache();
      // ONE alert for the whole order. This shortcut has no approval gate of any
      // kind (see the controller — it needs only dispatch:create), so it is the
      // path where an alert matters most.
      this.notifier.orderFullyDispatched({
        actorId: actor?.id ?? null,
        userName: actor?.name ?? null,
        orderId: order.id,
        orderCode: order.code ?? this.orderCodeFor(order.id),
        customerName: order.customerName,
        itemCount: result.dispatched,
      });
    }
    return result;
```

- [ ] **Step 6: Hook `update()`**

In `update()`, inside the existing `if (changes.length) { ... }` block, after the `this.logDispatch({ ... });` call:

```ts
      this.notifier.dispatchUpdated({
        actorId: actor?.id ?? null,
        userName: actor?.name ?? null,
        dispatchId: id,
        dispatchCode: cur.code ?? this.codeFor(id),
        customerName: cur.customerName,
        // The very same text the dispatch's Activity History shows.
        changes: changes.join('; '),
      });
```

- [ ] **Step 7: Hook `remove()`**

Replace `remove()` entirely:

```ts
  async remove(id: number, actor?: Actor): Promise<void> {
    // Read the row before deleting it: the alert has to name the party, item and
    // quantities that are about to stop existing.
    const row = await this.prisma.dispatch.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dispatch not found.');
    await this.assertNotBilled(id);
    await this.prisma.dispatch.delete({ where: { id } });
    this.invalidatePendingCache(); // a deleted dispatch puts its qty back in the pool
    this.notifier.dispatchDeleted({
      actorId: actor?.id ?? null,
      userName: actor?.name ?? null,
      dispatchCode: row.code ?? this.codeFor(id),
      customerName: row.customerName,
      productName: row.productName,
      bags: row.bags,
      pcs: row.pcs,
      gram: row.gram,
      box: row.box,
    });
  }
```

- [ ] **Step 8: Pass the actor from the controller**

In `apps/api/src/dispatch/dispatch.controller.ts`, replace `fulfillOrder` (line 151-156):

```ts
  /** Fully dispatch every pending line of an order at once — the New Order form's
   *  "Create & Dispatch" calls this right after the order is created. */
  @Post('fulfill-order/:orderId')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Fully dispatched an order (Create & Dispatch)' })
  fulfillOrder(@Param('orderId', ParseIntPipe) orderId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatch.dispatchOrderFully(orderId, { id: user.id ?? null, name: user.name });
  }
```

and `remove` (line 170-176):

```ts
  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted a dispatch' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    await this.dispatch.remove(id, { id: user.id ?? null, name: user.name });
    return { ok: true };
  }
```

- [ ] **Step 9: Verify it compiles**

Run: `npm run lint -w @oms/api`
Expected: exits 0.

If `@CurrentUser('name') userName: string` is now unused anywhere, remove the leftover parameter — `tsc` with `noUnusedParameters` would flag it.

- [ ] **Step 10: Verify no other caller broke**

Run:
```bash
grep -rn "dispatchOrderFully\|\.remove(" apps/api/src --include=*.ts | grep -v dist | grep -i dispatch
```
Expected: only `dispatch.service.ts` (the definitions) and `dispatch.controller.ts` (the two updated call sites). Any other caller must be updated to the new signatures.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/dispatch apps/api/src/approvals
git commit -m "feat(api): raise dispatch alerts on all five dispatch paths"
```

---

### Task 5: Web delivery — socket listener and service worker

**Files:**
- Modify: `apps/web/src/lib/notifications-socket.ts:3`, `:51`
- Modify: `apps/web/public/sw.js:7`, `:133-137`

**Interfaces:**
- Consumes: `AppNotification` (Task 1); the `'notification'` Socket.IO event emitted by `NotificationsGateway.notifyUsers` (pre-existing).

- [ ] **Step 1: Listen for `'notification'`**

In `apps/web/src/lib/notifications-socket.ts`, add `AppNotification` to the type import on line 3:

```ts
import type { AppNotification, TestNotificationPayload } from '@oms/shared';
```

Then insert this handler after the `challans:pending-changed` handler and before the `auth:signed-out` one:

```ts
  // A notification addressed to this user specifically — currently dispatch
  // alerts. The gateway has ALWAYS emitted this event (notifyUsers), but nothing
  // listened for it here, so every targeted in-app notification was silently
  // dropped. Web Push covers the closed-app case separately.
  socket.on('notification', (n: AppNotification) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(n.title, { body: n.body, icon: '/icons/icon-192.png' });
      } catch {
        /* ignore — some platforms restrict constructing Notification directly */
      }
    }
    playTestChime();
    toast.info(n.title, { description: n.body });
  });
```

`playTestChime` and `toast` are already imported in this file.

- [ ] **Step 2: Route the notification click and bump the cache**

In `apps/web/public/sw.js`, change line 7:

```js
const CACHE = 'oms-v12';
```

Bumping this is what makes browsers adopt the new worker — `activate` deletes every cache whose key isn't the current one. Without it, installed clients keep the old click handler.

Then replace the `url` computation in the `notificationclick` listener:

```js
  const d = event.notification.data ?? {};
  // followupId is checked first: CRM reminders also carry a `kind`, but theirs is
  // 'PAYMENT' / 'DELIVERY', never 'dispatch'.
  const url = d.followupId
    ? `/${d.kind === 'PAYMENT' ? 'crm/payments' : 'crm'}?followup=${d.followupId}`
    : d.kind === 'dispatch'
      ? '/dispatch'
      : '/';
```

`/dispatch` is the Modify Dispatch page (`apps/web/src/app/router.tsx:330`). It takes no query parameters, so the alert opens the list rather than a filtered view.

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint -w @oms/web`
Expected: exits 0. (`sw.js` is a plain static asset and is not type-checked; re-read it once to confirm the edit is syntactically valid JavaScript.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/notifications-socket.ts apps/web/public/sw.js
git commit -m "feat(web): receive targeted notifications in-app and route dispatch pushes"
```

---

### Task 6: Web — the Dispatch Alerts settings card

**Files:**
- Modify: `apps/web/src/features/settings/use-settings.ts:2`, `:12`, append hooks
- Create: `apps/web/src/features/settings/dispatch-alerts-card.tsx`
- Modify: `apps/web/src/features/settings/settings-page.tsx:38`, `:143-148`

**Interfaces:**
- Consumes: `DispatchAlertSettingsDto` / `DispatchAlertSettingsInput` (Task 1); `GET`/`PUT /settings/dispatch-alerts` (Task 2).

- [ ] **Step 1: Add the hooks**

In `apps/web/src/features/settings/use-settings.ts`, add `DispatchAlertSettingsDto` and `DispatchAlertSettingsInput` to the type import on line 2, and add the key next to the others (after line 12):

```ts
const DISPATCH_ALERTS_KEY = ['dispatch-alerts'] as const;
```

Then add, after `useUpdateDispatchBagThreshold`:

```ts
/** Which dispatch events alert the people holding `dispatchalert:notify`. */
export function useDispatchAlerts() {
  return useQuery({
    queryKey: DISPATCH_ALERTS_KEY,
    queryFn: () => http.get<DispatchAlertSettingsDto>('/settings/dispatch-alerts'),
    staleTime: 60_000,
  });
}

export function useUpdateDispatchAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DispatchAlertSettingsInput) =>
      http.put<DispatchAlertSettingsDto>('/settings/dispatch-alerts', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: DISPATCH_ALERTS_KEY }),
  });
}
```

- [ ] **Step 2: Create the card**

Create `apps/web/src/features/settings/dispatch-alerts-card.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DispatchAlertSettingsDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useDispatchAlerts, useUpdateDispatchAlerts } from './use-settings';

const ALL_OFF: DispatchAlertSettingsDto = {
  enabled: false,
  onCreate: false,
  onBulk: false,
  onBackdateApproved: false,
  onEdit: false,
  onDelete: false,
};

/** The five events, in the order they read most naturally on screen. */
const EVENTS: { key: Exclude<keyof DispatchAlertSettingsDto, 'enabled'>; label: string; hint: string }[] = [
  { key: 'onCreate', label: 'New dispatch saved', hint: 'Someone records a dispatch on the Dispatch form.' },
  {
    key: 'onBulk',
    label: 'Whole order dispatched (Create & Dispatch)',
    hint: 'The New Order shortcut ships every line at once — one alert per order, not per item. This path needs no approval of any kind.',
  },
  {
    key: 'onBackdateApproved',
    label: 'Back-dated dispatch approved',
    hint: 'Fires when an approver signs one off and it becomes real — not when it is requested.',
  },
  { key: 'onEdit', label: 'Dispatch edited', hint: 'Quantity, status, date or remark changed on an existing dispatch.' },
  { key: 'onDelete', label: 'Dispatch deleted', hint: 'An existing dispatch was removed.' },
];

/**
 * Who hears about dispatches, and about what.
 *
 * Recipients are not chosen here — they are everyone whose role grants
 * "Dispatch Alerts: notify" on Roles & Permissions (Super Admin always does).
 * This card only decides which EVENTS are worth an alert.
 */
export function DispatchAlertsCard({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useDispatchAlerts();
  const save = useUpdateDispatchAlerts();
  const [form, setForm] = useState<DispatchAlertSettingsDto>(ALL_OFF);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = (key: keyof DispatchAlertSettingsDto, value: boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onSave = () =>
    save.mutate(form, {
      onSuccess: () => toast.success('Dispatch alerts saved'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-amber-600" /> Dispatch Alerts
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Tells everyone whose role grants <strong>Dispatch Alerts: notify</strong> when a user dispatches party items —
          in the app, and on their phone even when it is closed. You are never alerted about your own dispatches.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-muted-foreground flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <Switch checked={form.enabled} disabled={!canEdit} onCheckedChange={(v) => set('enabled', v)} />
              Send dispatch alerts
            </label>

            <div className="space-y-2.5 border-t pt-3">
              {EVENTS.map((e) => (
                <label key={e.key} className="flex items-start gap-2.5 text-sm">
                  <Switch
                    checked={form[e.key]}
                    // Greyed out while the master switch is off, so it is obvious
                    // that ticking one alone would do nothing.
                    disabled={!canEdit || !form.enabled}
                    onCheckedChange={(v) => set(e.key, v)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{e.label}</span>
                    <span className="text-muted-foreground block text-xs">{e.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {canEdit && (
              <Button onClick={onSave} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : null} Save dispatch alerts
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Mount it on the Dispatch tab**

In `apps/web/src/features/settings/settings-page.tsx`, add the import next to `DesignTrackCard` (line 38):

```ts
import { DispatchAlertsCard } from './dispatch-alerts-card';
```

and add the card to the dispatch tab (line 143-148):

```tsx
      {tab === 'dispatch' && (
        <div className="space-y-4">
          <DispatchBagThresholdCard canEdit={canEdit} />
          <DispatchAlertsCard canEdit={canEdit} />
          <DesignTrackCard canEdit={canEdit} />
        </div>
      )}
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint -w @oms/web`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/settings
git commit -m "feat(web): Dispatch Alerts settings card"
```

---

### Task 7: Register the permission and verify end to end

**Files:** none modified — this task registers the permission on the live database and proves the feature actually works.

**Interfaces:**
- Consumes: everything from Tasks 1-6.

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: exits 0. Shared, API and web all compile.

- [ ] **Step 2: Back up the database before touching it**

Run:
```bash
cp apps/api/prisma/dev.db "apps/api/prisma/dev.db.bak-before-dispatch-alerts"
```
Expected: the file exists. This is a checkpoint before a write to the live database, matching the existing `dev.db.bak-*` convention in that folder.

- [ ] **Step 3: Register the permission**

Run: `npm run db:seed:permissions -w @oms/api`
Expected output contains `1 newly added.` and **no** "Pruned" line. A pruned permission means something was accidentally removed from the catalog — stop and investigate before continuing.

- [ ] **Step 4: Confirm it landed in the database**

Run:
```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.permission.findMany({where:{resource:'dispatchalert'}}).then(r=>{console.log(r);return p.\$disconnect()})"
```
Expected: exactly one row, `key: 'dispatchalert:notify'`.

- [ ] **Step 5: Start the app**

Run: `npm run dev`
Expected: API and web both start. Sign in as a Super Admin.

- [ ] **Step 6: Grant it to Admin**

In the app: **Roles & Permissions → the `admin` role → Sales → Dispatch Alerts → tick `notify` → Save.**
Expected: saves without error, and the tick survives a page reload.

This is required — the seed script deliberately does not modify role grants, so Admin has no alerts until this is done.

- [ ] **Step 7: Verify the shipped default is silent**

With Settings → Dispatch → Dispatch Alerts still showing everything off, record a dispatch from the Dispatch form.
Expected: the dispatch **saves normally**, and **no** toast, chime or push appears anywhere.

- [ ] **Step 8: Enable and verify a single dispatch alert**

Enable the master switch + "New dispatch saved" and save. Sign in as a non-admin (Operator) in a second browser, with the Super Admin's tab open.
Record a dispatch as the Operator.
Expected on the Super Admin tab: a toast titled `Dispatch — <party>` whose body shows the real quantities, status, item and order code, ending `by <operator name>`.
Expected on the Operator's own tab: **nothing** (self-exclusion).

- [ ] **Step 9: Verify the dedupe guard**

As the Operator, submit the same dispatch twice within 15 seconds (double-tap Save).
Expected: exactly **one** alert on the admin tab, not two — the second submission is merged by `DISPATCH_DEDUPE_WINDOW_MS`.

- [ ] **Step 10: Verify the bulk path is grouped**

Enable "Whole order dispatched". As the Operator, create an order with at least 3 lines and use **Create & Dispatch**.
Expected: exactly **one** alert reading `Full order dispatched — <party>` with the correct item count. **Not** one alert per line.

- [ ] **Step 11: Verify edit and delete**

Enable "Dispatch edited" and "Dispatch deleted". As the Operator, change a dispatch's quantity, then delete a different (unbilled) dispatch.
Expected: an alert whose change text matches, word for word, what that dispatch's own Activity History panel records; and a delete alert naming the party, code and quantities.

- [ ] **Step 12: Verify approval path**

Enable "Back-dated dispatch approved". As the Operator, submit a dispatch dated yesterday (raises an approval). Approve it as the Super Admin.
Expected: an alert reading `Back-dated dispatch approved — <party>`, naming both the requester and the approver. The approving Super Admin does not receive it themselves; the Admin user does.

- [ ] **Step 13: Verify alerting cannot break a dispatch**

Stop the API's socket consumers by closing every browser tab, then record a dispatch via the API (or simply confirm Step 7's behaviour with a zero-recipient audience by unticking `notify` for every role).
Expected: the dispatch **still saves and returns normally**. At most a `Dispatch alert (...) failed` warning appears in the API log.

- [ ] **Step 14: Report results honestly**

Write down, for each of Steps 7-13, what was actually observed. Any step that could not be run must be reported as not run — not as passing.

- [ ] **Step 15: Commit any fixes**

```bash
git add -A
git commit -m "fix: dispatch alerts issues found during verification"
```

(Skip this commit if verification found nothing to fix.)

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| 1. `dispatchalert:notify` permission | 1 (definition), 7 (registration + grant) |
| 2. Five trigger events + dedupe guard | 4 (hooks), 7 (Steps 8-12 verification) |
| 3. Settings card, all-off default, `AppConfig` | 2 (API), 6 (UI) |
| 4. Message content | 3 (composition), 7 (verification) |
| 5. Both delivery channels + the two client gaps | 3 (send), 5 (listener + service worker) |
| 6. Self-exclusion, incl. approver on the approval path | 3 (`fire` filter), 4 (Steps 1, 4, 5, 7, 8) |
| 7. `DispatchNotifier` boundary, module wiring | 3 |
| 8. Error-handling invariant | 3 (Step 2), 7 (Step 13) |
| Testing section | 7 |
| Risk: stale service worker | 5 (Step 2, `CACHE` bump) |
| Risk: Admin gets nothing after deploy | 7 (Step 6) |

No spec requirement is unassigned.

**Type consistency check:** `DispatchAlertEvent` values (`onCreate`, `onBulk`, `onBackdateApproved`, `onEdit`, `onDelete`) are identical in Task 1's type, Task 2's DTO and default, Task 3's `fire()` calls, and Task 6's `EVENTS` array. The notifier's five method names (`dispatchCreated`, `orderFullyDispatched`, `backdateApproved`, `dispatchUpdated`, `dispatchDeleted`) are defined in Task 3 and called with matching field names in Task 4. `qtyText` has exactly one definition (Task 3, Step 1).

**Placeholder scan:** every code step contains complete, runnable code. No TBD, no "handle errors appropriately", no "similar to Task N".
