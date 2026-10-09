import { Injectable } from '@nestjs/common';
import type { BillReadyAlertsDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationLedger } from '../notifications/notification-ledger.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PushService } from '../notifications/push.service';
import { UserPrefsService } from '../notifications/user-prefs.service';

const KEY = 'BILL_READY_ALERTS';

/**
 * "Bill ready — please collect": the Tally PC reports each bill it has finished
 * (e-invoice / e-way made and printed), and the people the admin picked in
 * Settings hear about it — in the app and as a phone notification.
 */
@Injectable()
export class BillReadyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly push: PushService,
    private readonly prefs: UserPrefsService,
    private readonly ledger: NotificationLedger,
  ) {}

  async getSettings(): Promise<BillReadyAlertsDto> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: KEY } });
    try {
      const v = JSON.parse(row?.value ?? '{}') as Partial<BillReadyAlertsDto>;
      return { enabled: v.enabled === true, userIds: Array.isArray(v.userIds) ? v.userIds.filter((u) => typeof u === 'string') : [] };
    } catch {
      return { enabled: false, userIds: [] };
    }
  }

  async saveSettings(dto: BillReadyAlertsDto): Promise<BillReadyAlertsDto> {
    const value = JSON.stringify({ enabled: !!dto.enabled, userIds: [...new Set(dto.userIds ?? [])] });
    await this.prisma.appConfig.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
    return this.getSettings();
  }

  /** A bill that never goes to Tally (the NB series) was made: nothing else reports it, so the same alert goes out when it is saved. */
  async created(p: { code: string; party: string; amount?: number | null }): Promise<{ sent: number }> {
    const s = await this.getSettings();
    if (!s.enabled || !s.userIds.length || !p.code) return { sent: 0 };
    return this.tell(s, `bill-ready:${p.code}`, this.notice(p.party, p.code, p.amount ?? null, ''));
  }

  private notice(party: string, billNo: string, amount: number | null, eway: string) {
    return {
      title: `Bill ready: ${party}`,
      body: [billNo, amount ? `₹${Math.round(amount).toLocaleString('en-IN')}` : '', eway ? `e-way ${eway}` : '']
        .filter(Boolean)
        .join(' · ') + ' — please collect the bill',
      data: { kind: 'bill-ready', billNo, party, amount, eway: eway || null },
    };
  }

  /** The Tally PC finished a bill. Best-effort: a failure here never reaches the PC. */
  async printed(p: { vchNo: string; party?: string; eway?: string }): Promise<{ sent: number }> {
    const s = await this.getSettings();
    if (!s.enabled || !s.userIds.length || !p.vchNo) return { sent: 0 };
    const tv = await this.prisma.tallyVoucher.findFirst({
      where: { vchNo: p.vchNo, vchType: 'Sales' },
      select: { amount: true, partyLedger: true, challan: { select: { code: true, customerName: true } } },
    });
    const party = tv?.challan?.customerName ?? tv?.partyLedger ?? p.party ?? '';
    const billNo = tv?.challan?.code ?? p.vchNo;
    const amount = tv?.amount ? Math.abs(tv.amount) : null;
    return this.tell(s, `bill-ready:${p.vchNo}`, this.notice(party, billNo, amount, p.eway || ''));
  }

  /** Once per person per bill (the ledger), skipping anyone on Do-not-disturb. */
  private async tell(s: BillReadyAlertsDto, key: string, notification: ReturnType<BillReadyService['notice']>): Promise<{ sent: number }> {
    const active = (await this.prisma.user.findMany({ where: { id: { in: s.userIds }, status: 'active' }, select: { id: true } })).map((u) => u.id);
    const awake = await this.prefs.notInDnd(active);
    const untold = await this.ledger.filterUntold(key, awake);
    if (!untold.length) return { sent: 0 };
    this.gateway.notifyUsers(untold, notification);
    await this.push.sendToUsers(untold, notification);
    await this.ledger.record(key, untold, notification.title, notification.body);
    return { sent: untold.length };
  }
}
