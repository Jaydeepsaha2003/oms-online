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

    const { roles, permissions } = flattenAccess(user);
    return { id: user.id, email: user.email, name: user.name, roles, permissions };
  }
}
