import { Injectable, NotFoundException } from '@nestjs/common';
import type { RefreshToken } from '@prisma/client';
import type { SessionDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toSessionDto } from './session-util';

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

  /** Repeated logins from the same browser/device (identical userAgent) collapse to
   *  one row — the caller's own current session if it's among them, otherwise the
   *  most recently created. Rows with no userAgent are never merged (no reliable
   *  way to say they're "the same device"). */
  private dedupeByDevice(rows: RefreshToken[], currentSid?: string): RefreshToken[] {
    const kept: RefreshToken[] = [];
    const indexByAgent = new Map<string, number>();
    for (const row of rows) {
      if (!row.userAgent) {
        kept.push(row);
        continue;
      }
      const existingIndex = indexByAgent.get(row.userAgent);
      if (existingIndex === undefined) {
        indexByAgent.set(row.userAgent, kept.length);
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
}
