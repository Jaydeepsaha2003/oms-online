import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isWithinDnd, type DndSource, type EffectiveDndDto, type NotificationDndDto, type UserDndRow } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

const DND_KEY = 'NOTIFY_DND';
/** The company-wide window, in appConfig — one row, not one per user. */
const DND_DEFAULT_KEY = 'NOTIFY_DND_DEFAULT';

/**
 * The fallback when nothing at all has been configured — off, with a sensible
 * night window pre-filled so switching it on is one tap.
 *
 * Not the same thing as the COMPANY default below: this is what the company
 * default itself starts as.
 */
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

  /**
   * The company-wide window every user follows unless they have their own.
   *
   * Stored in appConfig rather than as a row per user, so changing it moves
   * everyone who has not opted out — which is the point of a default. Adding a
   * new user needs no setup at all.
   */
  async getDefaultDnd(): Promise<NotificationDndDto> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: DND_DEFAULT_KEY } });
    return row?.value ? this.parse(row.value) : DEFAULT_DND;
  }

  async setDefaultDnd(dto: NotificationDndDto): Promise<NotificationDndDto> {
    const value = this.validate(dto);
    await this.prisma.appConfig.upsert({
      where: { key: DND_DEFAULT_KEY },
      update: { value: JSON.stringify(value) },
      create: { key: DND_DEFAULT_KEY, value: JSON.stringify(value) },
    });
    return value;
  }

  /**
   * What is actually in force for this person, and which layer it came from.
   *
   * One rule: their own setting wins, otherwise the company default. An override
   * exists as a ROW, which is what lets "off for me" be a real answer rather
   * than collapsing into "no preference" — someone who deliberately opts out of
   * a company-wide quiet window must stay opted out when that window changes.
   */
  async getDnd(userId: string): Promise<EffectiveDndDto> {
    const [row, companyDefault] = await Promise.all([
      this.prisma.userPreference.findUnique({ where: { userId_key: { userId, key: DND_KEY } } }),
      this.getDefaultDnd(),
    ]);
    const source: DndSource = row ? 'personal' : 'default';
    return { ...(row ? this.parse(row.value) : companyDefault), source, companyDefault };
  }

  /** Drop a personal override so this person follows the company default again. */
  async clearDnd(userId: string): Promise<EffectiveDndDto> {
    await this.prisma.userPreference.deleteMany({ where: { userId, key: DND_KEY } });
    return this.getDnd(userId);
  }

  /** Shared by both setters — one place decides what a valid window is. */
  private validate(dto: NotificationDndDto): NotificationDndDto {
    if (!HHMM.test(dto.start) || !HHMM.test(dto.end)) {
      throw new BadRequestException('Quiet hours must be times like 21:00.');
    }
    if (dto.start === dto.end) {
      throw new BadRequestException('Quiet hours cannot start and end at the same time.');
    }
    return { enabled: !!dto.enabled, start: dto.start, end: dto.end };
  }

  async setDnd(userId: string, dto: NotificationDndDto): Promise<NotificationDndDto> {
    const value = this.validate(dto);
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
    const [users, rows, companyDefault] = await Promise.all([
      this.prisma.user.findMany({
        select: { id: true, name: true, email: true, status: true },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.userPreference.findMany({ where: { key: DND_KEY }, select: { userId: true, value: true } }),
      this.getDefaultDnd(),
    ]);
    const stored = new Map(rows.map((r) => [r.userId, r.value]));
    return users.map((u) => {
      const raw = stored.get(u.id);
      // Everyone is listed with the window actually in force for them, whether
      // that is their own or the company's — a screen showing blanks for the
      // majority would answer nothing.
      const dnd = raw ? this.parse(raw) : companyDefault;
      return {
        userId: u.id, name: u.name, email: u.email, status: u.status,
        configured: raw != null,
        source: raw ? ('personal' as const) : ('default' as const),
        ...dnd,
      };
    });
  }

  /**
   * Set quiet hours for somebody else.
   *
   * Writes the SAME record the person edits in their own Settings, so an
   * administrator and the user are never editing two different things. Doing so
   * creates a personal OVERRIDE: from then on this user stops following the
   * company default until `clearDndFor` puts them back on it.
   */
  async setDndFor(userId: string, dto: NotificationDndDto): Promise<UserDndRow> {
    // Belt for the route-order trap noted on the controller: "default" is the
    // company setting's path segment, never a user id.
    if (userId === 'default') throw new BadRequestException('Use the company-default endpoint for that.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    const saved = await this.setDnd(userId, dto);
    // Setting someone's window IS the override, so the source is personal.
    return { userId: user.id, name: user.name, email: user.email, status: user.status, configured: true, source: 'personal', ...saved };
  }

  /** Put one person back on the company default, from the administration screen. */
  async clearDndFor(userId: string): Promise<UserDndRow> {
    // Belt for the route-order trap noted on the controller: "default" is the
    // company setting's path segment, never a user id.
    if (userId === 'default') throw new BadRequestException('Use the company-default endpoint for that.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    await this.prisma.userPreference.deleteMany({ where: { userId, key: DND_KEY } });
    const companyDefault = await this.getDefaultDnd();
    return { userId: user.id, name: user.name, email: user.email, status: user.status, configured: false, source: 'default', ...companyDefault };
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
    const [rows, companyDefault] = await Promise.all([
      this.prisma.userPreference.findMany({
        where: { userId: { in: userIds }, key: DND_KEY },
        select: { userId: true, value: true },
      }),
      this.getDefaultDnd(),
    ]);
    const overrides = new Map(rows.map((r) => [r.userId, this.parse(r.value)]));
    /*
     * The default is applied to everyone WITHOUT an override — that is what
     * makes it a default rather than a suggestion. Someone who has explicitly
     * turned their own off keeps it off, because their row says so.
     *
     * `parse` falls back to disabled on an unreadable row, so a corrupt
     * preference means "not quiet" rather than accidentally muting someone.
     */
    const quiet = new Set<string>();
    for (const id of userIds) {
      if (isWithinDnd(overrides.get(id) ?? companyDefault, at)) quiet.add(id);
    }
    return userIds.filter((id) => !quiet.has(id));
  }
}
