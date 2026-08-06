import { Injectable, NotFoundException } from '@nestjs/common';
import type { RefreshToken } from '@prisma/client';
import type { SessionDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { normaliseIp, parseUserAgent, toSessionDto } from './session-util';

/**
 * Active sign-in sessions = a user's non-revoked, unexpired refresh tokens (one
 * per device after rotation). Revoking a session logs that device out on its next
 * request (the JWT guard rejects a revoked `sid`).
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A user's active sessions, newest first, deduplicated to one row per device.
   *  `currentSid` marks the caller's own. */
  async list(userId: string, currentSid?: string): Promise<SessionDto[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return this.dedupeByDevice(rows, currentSid).map((r) => toSessionDto(r, currentSid));
  }

  /** Repeated logins from the same browser + OS on the same IP collapse to one row
   *  — the caller's own current session if it's among them, otherwise the most
   *  recently created. Keyed on the *parsed* browser/OS label rather than the raw
   *  user-agent string, since a browser point-release (e.g. a Chrome auto-update)
   *  changes the exact UA on every visit and would otherwise look like a "new"
   *  device each time. Rows with no userAgent are never merged (no reliable way
   *  to say they're "the same device"). */
  private dedupeByDevice(rows: RefreshToken[], currentSid?: string): RefreshToken[] {
    const kept: RefreshToken[] = [];
    const indexByDevice = new Map<string, number>();
    for (const row of rows) {
      if (!row.userAgent) {
        kept.push(row);
        continue;
      }
      const key = `${parseUserAgent(row.userAgent).label}|${normaliseIp(row.ip) ?? ''}`;
      const existingIndex = indexByDevice.get(key);
      if (existingIndex === undefined) {
        indexByDevice.set(key, kept.length);
        kept.push(row);
      } else if (row.id === currentSid) {
        kept[existingIndex] = row;
      }
    }
    return kept;
  }

  /** Revoke a single device's session (immediate logout via sid enforcement). */
  async revoke(userId: string, sessionId: string): Promise<{ id: string }> {
    const token = await this.prisma.refreshToken.findUnique({ where: { id: sessionId } });
    if (!token || token.userId !== userId) throw new NotFoundException('Session not found.');
    if (!token.revokedAt) {
      await this.prisma.refreshToken.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    }
    return { id: sessionId };
  }

  /**
   * Revoke every active session for the user. When `exceptSid` is given (self
   * "log out other devices") the caller's own session is kept and no tokenVersion
   * bump is done. Otherwise (full admin sign-out) tokenVersion is bumped so every
   * access token dies instantly.
   */
  async revokeAll(userId: string, exceptSid?: string): Promise<{ count: number }> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, ...(exceptSid ? { id: { not: exceptSid } } : {}) },
      data: { revokedAt: new Date() },
    });
    if (!exceptSid) {
      await this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    }
    return { count: res.count };
  }

  /**
   * Displace every other device for this user, keeping only `keepSid` — the
   * session that just signed in. Backs the one-device-at-a-time rule.
   *
   * Sets `expiresAt` alongside `revokedAt`, which matters: AuthService.refresh
   * deliberately honours a token revoked in the last 60s so that two tabs racing
   * to rotate don't log each other out. A device kicked by this would sit inside
   * that window and quietly mint itself a brand-new session — undoing the
   * eviction. Expiring the row instead trips refresh's earlier, absolute
   * expiry check, which has no grace period.
   *
   * `tokenVersion` is deliberately NOT bumped: the per-session `sid` check in
   * JwtStrategy already kills the evicted access tokens instantly, whereas a
   * bump would also invalidate the token just issued to the new device.
   *
   * Returns the evicted session ids so the caller can push them a live logout.
   */
  async keepOnly(userId: string, keepSid: string): Promise<string[]> {
    const doomed = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, id: { not: keepSid } },
      select: { id: true },
    });
    if (!doomed.length) return [];
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: { id: { in: doomed.map((d) => d.id) } },
      data: { revokedAt: now, expiresAt: now },
    });
    return doomed.map((d) => d.id);
  }
}
