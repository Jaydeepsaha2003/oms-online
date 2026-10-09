import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ALL_PERMISSIONS } from '@oms/shared';
import { NotificationAudienceService } from '../notifications/notification-audience.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PushService } from '../notifications/push.service';

export interface ChequePhotoRequest {
  id: string;
  partyName: string;
  chequeAmt: number | null;
  requestedBy: string | null;
  photoUrl: string | null;
  createdAt: number;
}

/** A request outlives the form that asked for it by this long, then is forgotten. */
const TTL_MS = 30 * 60_000;

/**
 * "Request photo from phone": the desktop Add Cheque form asks, the system
 * admin's phone gets a push, its tap opens /cheque-photo/:id, the photo taken
 * there lands back in the waiting form (which polls).
 *
 * ponytail: kept in memory — a request lives minutes and is worthless after a
 * restart (the form that asked is gone too). Move to a table if that changes.
 */
@Injectable()
export class ChequePhotoRequestsService {
  private readonly requests = new Map<string, ChequePhotoRequest>();

  constructor(
    private readonly audience: NotificationAudienceService,
    private readonly gateway: NotificationsGateway,
    private readonly push: PushService,
  ) {}

  async create(p: { partyName?: string | null; chequeAmt?: number | null }, requestedBy: string | null): Promise<ChequePhotoRequest> {
    this.prune();
    const r: ChequePhotoRequest = {
      id: randomUUID(),
      partyName: p.partyName?.trim() || '',
      chequeAmt: p.chequeAmt ?? null,
      requestedBy,
      photoUrl: null,
      createdAt: Date.now(),
    };
    this.requests.set(r.id, r);
    const admins = await this.audience.userIdsWith(ALL_PERMISSIONS);
    const notification = {
      title: 'Cheque photo needed',
      body: [r.partyName, r.chequeAmt ? `₹${r.chequeAmt.toLocaleString('en-IN')}` : null, requestedBy ? `asked by ${requestedBy}` : null].filter(Boolean).join(' · ') + ' — tap to take the photo',
      data: { kind: 'cheque-photo', url: `/cheque-photo/${r.id}` },
    };
    // Asked for right now by someone waiting at a desk, so no DND filter or dedupe.
    this.gateway.notifyUsers(admins, notification);
    await this.push.sendToUsers(admins, notification);
    return r;
  }

  get(id: string): ChequePhotoRequest {
    const r = this.requests.get(id);
    if (!r || Date.now() - r.createdAt > TTL_MS) throw new NotFoundException('This photo request has expired — ask again from the cheque form.');
    return r;
  }

  complete(id: string, photoUrl: string): ChequePhotoRequest {
    const r = this.get(id);
    r.photoUrl = photoUrl;
    return r;
  }

  private prune(): void {
    for (const [id, r] of this.requests) if (Date.now() - r.createdAt > TTL_MS) this.requests.delete(id);
  }
}
