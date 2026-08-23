import { Injectable, Logger } from '@nestjs/common';
import { ACTIONS, perm, RESOURCES, type AppNotification } from '@oms/shared';
import { SettingsService } from '../settings/settings.service';
import { NotificationAudienceService } from './notification-audience.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationLedger } from './notification-ledger.service';
import { PushService } from './push.service';

/** Who performed the action. `actorId` is excluded — nobody is told about their
 *  own work. */
interface Actor {
  actorId?: string | null;
  userName?: string | null;
}

/**
 * Shop-floor news: a new order arrived, an order changed, a Design Track figure
 * was entered.
 *
 * Deliberately NOT behind a dedicated "notify" permission. The point of these is
 * that the people who then have to dispatch and process the work find out it
 * exists, so the audience is simply whoever can already open the screens the news
 * concerns (dispatch / design track / orders). Requiring a separate grant is what
 * left the dispatch alerts reaching nobody for as long as they have existed.
 *
 * The master `enabled` switch in Settings → Dispatch alerts still governs
 * everything here, so there remains one place to turn all alerting off.
 *
 * Every method returns void and swallows its own failures: an unreachable socket
 * server or a dead push endpoint must never fail, slow or roll back the order
 * that triggered it. The order is the real work; the alert is commentary.
 */
@Injectable()
export class ActivityNotifier {
  private readonly logger = new Logger(ActivityNotifier.name);

  /** Anyone who works the screens this news concerns. */
  private readonly floorPermissions = [
    perm(RESOURCES.DISPATCH, ACTIONS.VIEW),
    perm(RESOURCES.DESIGN_TRACK, ACTIONS.VIEW),
    perm(RESOURCES.ORDER, ACTIONS.VIEW),
  ];

  constructor(
    private readonly settings: SettingsService,
    private readonly audience: NotificationAudienceService,
    private readonly gateway: NotificationsGateway,
    private readonly push: PushService,
    private readonly ledger: NotificationLedger,
  ) {}

  /** A new order was placed — dispatch and design track both need to know. */
  orderCreated(f: Actor & { orderId: number; orderCode?: string | null; customerName: string; itemCount: number }): void {
    const code = f.orderCode || `#${f.orderId}`;
    this.fire(
      {
        title: `New order — ${f.customerName}`,
        body: this.line([code, this.items(f.itemCount), this.by(f.userName)]),
        data: { kind: 'order', orderId: f.orderId, orderCode: f.orderCode ?? null },
      },
      f.actorId,
      `order:created:${f.orderId}`,
    );
  }

  /** An existing order's lines changed (Order Modify, or a quotation revived). */
  orderUpdated(
    f: Actor & { orderId: number; orderCode?: string | null; customerName: string; itemCount: number; summary?: string | null },
  ): void {
    const code = f.orderCode || `#${f.orderId}`;
    this.fire(
      {
        title: `Order updated — ${f.customerName}`,
        body: this.line([code, f.summary ?? null, this.items(f.itemCount), this.by(f.userName)]),
        data: { kind: 'order', orderId: f.orderId, orderCode: f.orderCode ?? null },
      },
      f.actorId,
      `order:updated:${f.orderId}:${f.summary ?? f.itemCount}`,
    );
  }

  /** A Design Track processed ("Kalwat") figure was entered or changed. */
  designTrackUpdated(
    f: Actor & {
      orderItemId: number;
      customerName?: string | null;
      productName?: string | null;
      designType?: string | null;
      kalwat?: number | null;
    },
  ): void {
    const item = this.itemText(f.productName, f.designType);
    this.fire(
      {
        title: `Design Track — ${f.customerName?.trim() || item || 'updated'}`,
        body: this.line([
          item,
          f.kalwat != null ? `processed ${f.kalwat}` : null,
          this.by(f.userName),
        ]),
        data: { kind: 'design-track', orderItemId: f.orderItemId },
      },
      f.actorId,
      // The figure is part of the identity: entering 40 then 45 is two events,
      // the same 45 replayed is one.
      `design-track:${f.orderItemId}:${f.kalwat ?? ''}`,
    );
  }

  /* ── internals ─────────────────────────────────────────────────────────── */

  private items(n: number): string | null {
    if (!n) return null;
    return `${n} item${n === 1 ? '' : 's'}`;
  }

  private by(userName?: string | null): string | null {
    return userName ? `by ${userName}` : null;
  }

  /** Joins the parts that are actually present, so a missing one never leaves a
   *  dangling separator. */
  private line(parts: (string | null | undefined)[]): string {
    return parts
      .map((p) => p?.trim())
      .filter(Boolean)
      .join(' · ');
  }

  /** "10 RDX WL+LOGO" — the design is appended only when it is a real one AND
   *  the product name does not already carry it. Composite product names on this
   *  system routinely end with the design ("8 AJUBA THAPPI WL+LOGO"), which
   *  appending blindly turns into "8 AJUBA THAPPI WL+LOGO WL+LOGO".
   *  Imported lines store the literal string "NA", which is noise in an alert. */
  private itemText(productName?: string | null, designType?: string | null): string | null {
    const product = productName?.trim() || null;
    const design = designType?.trim();
    const realDesign = design && design.toUpperCase() !== 'NA' ? design : null;
    if (!product) return realDesign;
    if (!realDesign) return product;
    const alreadyNamed = product.toUpperCase().includes(realDesign.toUpperCase());
    return alreadyNamed ? product : `${product} ${realDesign}`;
  }

  /**
   * Send, if alerting is switched on and anyone is listening.
   *
   * Fire-and-forget on purpose: the caller gets control back immediately and can
   * never be blocked or failed by delivery. The whole body is guarded — nobody
   * awaits this promise, so an escaping rejection would surface as an unhandled
   * rejection rather than a caller-visible error.
   */
  /**
   * @param dedupeKey identifies the EVENT — "design track 41 updated", not the
   *   wording of the message. Anyone who has already had this event inside the
   *   ledger's cooldown is dropped from the recipients, so a replayed action
   *   cannot notify the same person twice.
   */
  private fire(notification: AppNotification, actorId?: string | null, dedupeKey?: string): void {
    void (async () => {
      try {
        const flags = await this.settings.getDispatchAlerts();
        if (!flags.enabled) return;

        const all = await this.audience.userIdsWithAny(this.floorPermissions);
        // Nobody is told about their own action.
        const recipients = actorId ? all.filter((id) => id !== actorId) : all;
        // An empty audience sends NOTHING. "Nobody is listening" must never
        // become "tell everyone" — a push notification outlives the session that
        // made it and sits on a lock screen.
        if (!recipients.length) return;

        // Anyone already told about THIS event is dropped here.
        const untold = dedupeKey ? await this.ledger.filterUntold(dedupeKey, recipients) : recipients;
        if (!untold.length) return;

        this.gateway.notifyUsers(untold, notification);
        await this.push.sendToUsers(untold, notification);
        // Recorded after the send, so a failure is not remembered as a success.
        if (dedupeKey) await this.ledger.record(dedupeKey, untold, notification.title, notification.body);
      } catch (err) {
        this.logger.warn(`Activity alert failed: ${(err as Error).message}`);
      }
    })();
  }
}
