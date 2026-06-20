import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import {
  AUDIT_ACTIONS,
  type AuthResult,
  type AuthUser,
  type JwtPayload,
  RESOURCES,
} from '@oms/shared';
import type { JwtConfig } from '../config/configuration';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { flattenAccess, USER_ACCESS_INCLUDE, type UserWithAccess } from './user-access.util';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedSession {
  auth: AuthResult;
  /** Raw refresh token — the controller stores it in an httpOnly cookie. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly jwtCfg: JwtConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.jwtCfg = config.get<JwtConfig>('jwt')!;
  }

  // ── Public operations ─────────────────────────────────────────────────────

  async login(email: string, password: string, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: USER_ACCESS_INCLUDE,
    });
    const generic = 'Invalid email or password.';
    if (!user) return this.failLogin(email, null, 'Unknown email', meta, generic);
    if (user.status !== 'active')
      return this.failLogin(email, user.id, 'Account not active', meta, generic);
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return this.failLogin(email, user.id, 'Bad password', meta, generic);
    return this.finishLogin(user, meta, 'Signed in');
  }

  async loginWithPin(email: string, pin: string, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: USER_ACCESS_INCLUDE,
    });
    const generic = 'Invalid email or PIN.';
    if (!user) return this.failLogin(email, null, 'Unknown email', meta, generic);
    if (user.status !== 'active')
      return this.failLogin(email, user.id, 'Account not active', meta, generic);
    if (!user.pinHash) return this.failLogin(email, user.id, 'PIN not set', meta, generic);
    const ok = await bcrypt.compare(pin, user.pinHash);
    if (!ok) return this.failLogin(email, user.id, 'Bad PIN', meta, generic);
    return this.finishLogin(user, meta, 'Signed in with PIN');
  }

  /** Set or replace the current user's quick-login PIN. */
  async setPin(userId: string, pin: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const pinHash = await bcrypt.hash(pin, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { pinHash } });
    await this.audit.record({
      userId,
      userEmail: user.email,
      action: AUDIT_ACTIONS.UPDATE,
      resource: RESOURCES.USER,
      resourceId: userId,
      description: 'Set quick-login PIN',
      statusCode: 200,
    });
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token.');
    const tokenHash = this.hashToken(rawToken);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: USER_ACCESS_INCLUDE } },
    });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    if (existing.user.status !== 'active') {
      throw new UnauthorizedException('Account is not active.');
    }

    // Rotate: revoke the used token and issue a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return this.issueSession(existing.user, meta);
  }

  async logout(rawToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!rawToken) return;
    const tokenHash = this.hashToken(rawToken);
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (token && !token.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        userId: token.userId,
        action: AUDIT_ACTIONS.LOGOUT,
        resource: RESOURCES.USER,
        description: 'Signed out',
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        statusCode: 200,
      });
    }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect.');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    // Bumping tokenVersion invalidates existing access tokens; revoke refresh tokens too.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      userId,
      userEmail: user.email,
      action: AUDIT_ACTIONS.UPDATE,
      resource: RESOURCES.USER,
      resourceId: userId,
      description: 'Changed own password',
      statusCode: 200,
    });
  }

  /** Build the AuthUser payload for /auth/me from the request user id. */
  async currentUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: USER_ACCESS_INCLUDE,
    });
    if (!user) throw new UnauthorizedException();
    return this.buildAuthUser(user);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async finishLogin(
    user: UserWithAccess,
    meta: RequestMeta,
    description: string,
  ): Promise<IssuedSession> {
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const session = await this.issueSession(user, meta);
    await this.audit.record({
      userId: user.id,
      userEmail: user.email,
      action: AUDIT_ACTIONS.LOGIN,
      resource: RESOURCES.USER,
      description,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      statusCode: 200,
    });
    return session;
  }

  private async failLogin(
    email: string,
    userId: string | null,
    reason: string,
    meta: RequestMeta,
    message: string,
  ): Promise<never> {
    await this.audit.record({
      userId,
      userEmail: email,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      resource: RESOURCES.USER,
      description: reason,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      statusCode: 401,
    });
    throw new UnauthorizedException(message);
  }

  private async issueSession(user: UserWithAccess, meta: RequestMeta): Promise<IssuedSession> {
    const payload: JwtPayload = { sub: user.id, email: user.email, tv: user.tokenVersion };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.jwtCfg.accessSecret,
      expiresIn: this.jwtCfg.accessTtl,
    } as JwtSignOptions);

    const refreshToken = randomBytes(48).toString('hex');
    const refreshExpiresAt = new Date(Date.now() + durationToMs(this.jwtCfg.refreshTtl));
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    const auth: AuthResult = {
      accessToken,
      expiresIn: Math.floor(durationToMs(this.jwtCfg.accessTtl) / 1000),
      tokenType: 'Bearer',
      user: this.buildAuthUser(user),
    };
    return { auth, refreshToken, refreshExpiresAt };
  }

  private buildAuthUser(user: UserWithAccess): AuthUser {
    const { roles, permissions } = flattenAccess(user);
    return { id: user.id, email: user.email, name: user.name, roles, permissions };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}

/** Parse a duration like '15m', '7d', '3600' (seconds) into milliseconds. */
export function durationToMs(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(value.trim());
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  const unit = match[2] ?? 's';
  const mult: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[unit] ?? 1000);
}
