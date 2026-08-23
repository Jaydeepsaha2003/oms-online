import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isWithinDnd, type NotificationDndDto, type UserDndRow } from '@oms/shared';
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
    return row ? this.parse(row.value) : DEFAULT_DND;
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
   * Everyone's quiet hours, for the administration screen.
   *
   * One query for the users and one for the preferences, joined in memory —
   * a per-user lookup would be an N+1 on a page that exists to show all of them
   * at once. Users with no stored preference are returned on the default rather
   * than omitted, so the screen shows the whole staff list and not just the
   * handful who have already set something.
   */
  async listDnd(): Promise<UserDndRow[]> {
    const [users, rows] = await Promise.all([
      this.prisma.user.findMany({
        select: { id: true, name: true, email: true, status: true },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.userPreference.findMany({ where: { key: DND_KEY }, select: { userId: true, value: true } }),
    ]);
    const stored = new Map(rows.map((r) => [r.userId, r.value]));
    return users.map((u) => {
      const raw = stored.get(u.id);
      const dnd = raw ? this.parse(raw) : DEFAULT_DND;
      return { userId: u.id, name: u.name, email: u.email, status: u.status, configured: raw != null, ...dnd };
    });
  }

  /**
   * Set quiet hours for somebody else.
   *
   * Writes the SAME record the person edits in their own Settings — there is
   * one window per user, not an admin one and a personal one. Whoever saved
   * last wins, which is the only rule that needs explaining.
   */
  async setDndFor(userId: string, dto: NotificationDndDto): Promise<UserDndRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    const saved = await this.setDnd(userId, dto);
    return { userId: user.id, name: user.name, email: user.email, status: user.status, configured: true, ...saved };
  }

  /** Shared by getDnd and listDnd so a corrupt row behaves identically in both. */
  private parse(value: string): NotificationDndDto {
    try {
      const parsed = JSON.parse(value) as Partial<NotificationDndDto>;
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
    // `parse` falls back to the default (disabled) on an unreadable row, so a
    // corrupt preference means "not quiet" rather than accidentally muting someone.
    const quiet = new Set<string>();
    for (const r of rows) {
      if (isWithinDnd(this.parse(r.value), at)) quiet.add(r.userId);
    }
    return userIds.filter((id) => !quiet.has(id));
  }
}
