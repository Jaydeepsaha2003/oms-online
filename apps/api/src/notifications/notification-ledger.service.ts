import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How long the same event stays "already told" for one person.
 *
 * Twelve hours, because the repeats worth stopping are the ones nobody asked
 * for — a service restart replaying an action, a duplicated event, two
 * processes briefly overlapping mid-deploy. All of those land within minutes.
 * A genuinely recurring reminder carries its own cycle in its key (see
 * FollowupPushScheduler), so it is not muted by this.
 */
const DEFAULT_COOLDOWN_MS = 12 * 60 * 60_000;

/** Rows older than this are pruned — the ledger is a short-term memory, not history. */
const RETAIN_MS = 30 * 24 * 60 * 60_000;

/**
 * The record of what has actually been sent, per recipient.
 *
 * Before this existed nothing was written down, so no send path could ask "have
 * I already told them?" — a second attempt at the same notification looked
 * exactly like a first one and went out again. A push notification outlives the
 * session that produced it and sits on a lock screen, so a repeat is not
 * cosmetic.
 *
 * Written with raw SQL rather than the generated client on purpose: the table is
 * new, and regenerating the Prisma client on Windows replaces a DLL the running
 * API holds open. Three trivial statements against a table this shape do not
 * justify making a deploy a prerequisite for the code compiling.
 */
@Injectable()
export class NotificationLedger {
  private readonly logger = new Logger(NotificationLedger.name);
  private lastPrune = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Of these recipients, the ones who have NOT had this event inside the
   * cooldown — the list to actually send to.
   *
   * Returns everybody on an error rather than nobody: failing to read the
   * ledger should cost a duplicate at worst, never a missed alert. Silence is
   * the more expensive failure here.
   */
  async filterUntold(dedupeKey: string, userIds: string[], cooldownMs = DEFAULT_COOLDOWN_MS): Promise<string[]> {
    if (!userIds.length) return userIds;
    try {
      const since = new Date(Date.now() - cooldownMs);
      const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
        SELECT DISTINCT "userId" FROM "notification_log"
        WHERE "dedupeKey" = ${dedupeKey} AND "sentAt" >= ${since}
      `;
      if (!rows.length) return userIds;
      const told = new Set(rows.map((r) => r.userId));
      return userIds.filter((id) => !told.has(id));
    } catch (err) {
      this.logger.warn(`Ledger read failed for ${dedupeKey}: ${(err as Error).message}`);
      return userIds;
    }
  }

  /**
   * Write down that these people were told.
   *
   * Called AFTER the send, so a failed send is not remembered as a success —
   * that would suppress the retry. Never throws: a notification that went out
   * but was not recorded is a possible duplicate later, which is a smaller
   * problem than an exception unwinding the caller's transaction.
   */
  async record(dedupeKey: string, userIds: string[], title: string, body: string): Promise<void> {
    if (!userIds.length) return;
    try {
      for (const userId of userIds) {
        await this.prisma.$executeRaw`
          INSERT INTO "notification_log" ("dedupeKey", "userId", "title", "body", "sentAt")
          VALUES (${dedupeKey}, ${userId}, ${title}, ${body}, ${new Date()})
        `;
      }
      await this.pruneOccasionally();
    } catch (err) {
      this.logger.warn(`Ledger write failed for ${dedupeKey}: ${(err as Error).message}`);
    }
  }

  /** When each of these recipients last had this event — for diagnosing "why
   *  didn't I get told", which is the question this table gets asked. */
  async lastSent(dedupeKey: string): Promise<{ userId: string; sentAt: Date }[]> {
    try {
      return await this.prisma.$queryRaw<{ userId: string; sentAt: Date }[]>`
        SELECT "userId", MAX("sentAt") AS "sentAt" FROM "notification_log"
        WHERE "dedupeKey" = ${dedupeKey} GROUP BY "userId"
      `;
    } catch {
      return [];
    }
  }

  /** Prunes at most once an hour, and only from a send that already happened —
   *  no timer, so nothing runs on an idle server. */
  private async pruneOccasionally(): Promise<void> {
    if (Date.now() - this.lastPrune < 60 * 60_000) return;
    this.lastPrune = Date.now();
    try {
      const cutoff = new Date(Date.now() - RETAIN_MS);
      await this.prisma.$executeRaw`DELETE FROM "notification_log" WHERE "sentAt" < ${cutoff}`;
    } catch (err) {
      this.logger.warn(`Ledger prune failed: ${(err as Error).message}`);
    }
  }
}
