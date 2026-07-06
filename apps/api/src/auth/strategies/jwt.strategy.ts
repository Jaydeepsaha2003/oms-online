import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '@oms/shared';
import type { JwtConfig } from '../../config/configuration';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { flattenAccess, USER_ACCESS_INCLUDE } from '../user-access.util';

/**
 * Validates the access token on every protected request and rebuilds the live
 * permission set from the DB — so role/permission changes and forced logouts
 * (tokenVersion bumps) take effect immediately.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const jwt = config.get<JwtConfig>('jwt')!;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwt.accessSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: USER_ACCESS_INCLUDE,
    });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Account is not active.');
    }
    if (user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Session is no longer valid.');
    }
    // Per-device sign-out: reject the moment this session's refresh token is
    // revoked, so a remote logout takes effect on the very next request. (Refresh
    // is reactive — only on a 401 — so a live session's sid is never revoked by
    // normal rotation, and no grace window is needed here.) Legacy access tokens
    // without a sid are still honoured for backward compatibility.
    if (payload.sid) {
      const session = await this.prisma.refreshToken.findUnique({
        where: { id: payload.sid },
        select: { revokedAt: true },
      });
      if (!session || session.revokedAt) {
        throw new UnauthorizedException('This device was signed out.');
      }
    }

    const { roles, permissions } = flattenAccess(user);
    return { id: user.id, email: user.email, name: user.name, roles, permissions, sid: payload.sid };
  }
}
