import { Injectable, NotFoundException } from '@nestjs/common';
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

  /** A user's active sessions, newest first. `currentSid` marks the caller's own. */
  async list(userId: string, currentSid?: string): Promise<SessionDto[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => toSessionDto(r, currentSid));
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
