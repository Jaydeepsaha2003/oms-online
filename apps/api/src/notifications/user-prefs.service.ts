import { BadRequestException, Injectable } from '@nestjs/common';
import { isWithinDnd, type NotificationDndDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

const DND_KEY = 'NOTIFY_DND';

/** Off, with a sensible night window already filled in so switching it on is one tap. */
const DEFAULT_DND: NotificationDndDto = { enabled: false, start: '21:00', end: '08:00' };

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * Per-user notification preferences.
 *
 * Kept apart from the app-wide CRM reminder settings on purpose: those decide
 * WHEN a follow-up becomes due, which is a business rule and the same for
 * everyone. This decides whether a given PERSON is disturbed by it, which is
 * personal — the owner and a floor operator keep different hours.
 */
@Injectable()
export class UserPrefsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDnd(userId: string): Promise<NotificationDndDto> {
    const row = await this.prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: DND_KEY } },
    });
    if (!row) return DEFAULT_DND;
    try {
      const parsed = JSON.parse(row.value) as Partial<NotificationDndDto>;
      return {
        enabled: !!parsed.enabled,
        start: HHMM.test(parsed.start ?? '') ? parsed.start! : DEFAULT_DND.start,
        end: HHMM.test(parsed.end ?? '') ? parsed.end! : DEFAULT_DND.end,
      };
    } catch {
      // A corrupt row must not silence someone's reminders forever.
      return DEFAULT_DND;
    }
  }

  async setDnd(userId: string, dto: NotificationDndDto): Promise<NotificationDndDto> {
    if (!HHMM.test(dto.start) || !HHMM.test(dto.end)) {
      throw new BadRequestException('Quiet hours must be times like 21:00.');
    }
    if (dto.start === dto.end) {
      throw new BadRequestException('Quiet hours cannot start and end at the same time.');
    }
    const value: NotificationDndDto = { enabled: !!dto.enabled, start: dto.start, end: dto.end };
    await this.prisma.userPreference.upsert({
      where: { userId_key: { userId, key: DND_KEY } },
      update: { value: JSON.stringify(value) },
      create: { userId, key: DND_KEY, value: JSON.stringify(value) },
    });
    return value;
  }

  /**
   * Of these users, which are NOT in their quiet hours right now.
   *
   * Loads every relevant preference in one query — this runs on a 60-second
   * timer, so a per-user round trip would be the wrong shape. Anyone without a
   * stored preference is simply not filtered.
   */
  async notInDnd(userIds: string[], at: Date = new Date()): Promise<string[]> {
    if (!userIds.length) return userIds;
    const rows = await this.prisma.userPreference.findMany({
      where: { userId: { in: userIds }, key: DND_KEY },
      select: { userId: true, value: true },
    });
    if (!rows.length) return userIds;
    const quiet = new Set<string>();
    for (const r of rows) {
      try {
        if (isWithinDnd(JSON.parse(r.value) as NotificationDndDto, at)) quiet.add(r.userId);
      } catch {
        /* unreadable preference = no DND, rather than accidentally muting someone */
      }
    }
    return userIds.filter((id) => !quiet.has(id));
  }
}
