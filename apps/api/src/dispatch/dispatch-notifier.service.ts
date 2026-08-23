import { Injectable, Logger } from '@nestjs/common';
import { ACTIONS, perm, RESOURCES, type AppNotification, type DispatchAlertEvent } from '@oms/shared';
import { formatDate } from '../common/date.util';
import { NotificationAudienceService } from '../notifications/notification-audience.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationLedger } from '../notifications/notification-ledger.service';
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
    private readonly ledger: NotificationLedger,
  ) {}

  /** A dispatch was recorded from the Dispatch form. */
  dispatchCreated(
    f: Actor &
      Qty & {
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
    }, `dispatch:onCreate:${f.dispatchId}`);
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
    }, `dispatch:onBulk:${f.orderId}`);
  }

  /** A back-dated dispatch became real because an approver signed it off. The
   *  excluded actor is the APPROVER — they just decided it and know. The original
   *  requester is named in the body but still hears about it. */
  backdateApproved(
    f: Actor &
      Qty & {
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
    }, `dispatch:onBackdateApproved:${f.dispatchId}`);
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
    }, `dispatch:onEdit:${f.dispatchId}:${f.changes}`);
  }

  /** A dispatch was deleted. Carries the quantities it held, since the row is gone. */
  dispatchDeleted(
    f: Actor &
      Qty & {
        dispatchCode: string;
        customerName: string;
        productName?: string | null;
      },
  ): void {
    this.fire('onDelete', f.actorId, {
      title: `Dispatch deleted — ${f.customerName}`,
      body: this.line([f.dispatchCode, qtyText(f), f.productName, this.by(f.userName)]),
      data: { kind: 'dispatch' },
    }, `dispatch:onDelete:${f.dispatchCode}`);
  }

  /* ── internals ──────────────────────────────────────────────────────────── */

  /** Join the parts that carry a value with " · ", so an absent order code or
   *  design never leaves a dangling separator in the message. */
  private line(parts: (string | null | undefined)[]): string {
    return parts
      .map((p) => p?.trim())
      .filter(Boolean)
      .join(' · ');
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
  /**
   * @param dedupeKey identifies the EVENT, e.g. `dispatch:onCreate:4298`. A
   *   recipient who already had it inside the ledger's cooldown is skipped, so
   *   the same dispatch cannot be announced twice however the second attempt
   *   arises.
   */
  private fire(
    event: DispatchAlertEvent,
    actorId: string | null | undefined,
    notification: AppNotification,
    dedupeKey?: string,
  ): void {
    void (async () => {
      try {
        const flags = await this.settings.getDispatchAlerts();
        if (!flags.enabled || !flags[event]) return;

        // Anyone who works the dispatch floor, plus anyone explicitly granted
        // the dedicated alert permission.
        //
        // This used to ask ONLY for dispatchalert:notify, which no role holds
        // except super_admin's blanket grant — and super_admin is normally the
        // one performing the action, so it was filtered straight back out as the
        // actor. The audience resolved to nobody and these alerts reached no
        // phone at all. Reusing dispatch:view (which every operator already has,
        // because it gates the screen they work on) makes them land without
        // anybody having to be granted a new permission first.
        const all = await this.audience.userIdsWithAny([
          perm(RESOURCES.DISPATCH_ALERT, ACTIONS.NOTIFY),
          perm(RESOURCES.DISPATCH, ACTIONS.VIEW),
        ]);
        // Nobody is told about their own action.
        const recipients = actorId ? all.filter((id) => id !== actorId) : all;
        // An empty audience sends NOTHING. "Nobody is allowed" must never become
        // "tell everyone" — a push notification outlives the session that made it.
        if (!recipients.length) return;

        const untold = dedupeKey ? await this.ledger.filterUntold(dedupeKey, recipients) : recipients;
        if (!untold.length) return;

        this.gateway.notifyUsers(untold, notification);
        await this.push.sendToUsers(untold, notification);
        if (dedupeKey) await this.ledger.record(dedupeKey, untold, notification.title, notification.body);
      } catch (err) {
        this.logger.warn(`Dispatch alert (${event}) failed: ${(err as Error).message}`);
      }
    })();
  }
}
