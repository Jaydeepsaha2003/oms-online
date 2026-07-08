import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload, TestNotificationPayload } from '@oms/shared';
import { buildCorsOrigin } from '../common/cors-origin.util';
import { configuration } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
@WebSocketGateway({ cors: { origin: buildCorsOrigin(configuration()), credentials: true } })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Rejects the connection unless it carries a currently-valid access token. */
  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    const userId = token ? await this.verifyToken(token) : null;
    if (!userId) {
      client.disconnect(true);
    }
  }

  /** Same checks as JwtStrategy.validate: active user, current token version, session not revoked. */
  private async verifyToken(token: string): Promise<string | null> {
    try {
      const { jwt: jwtCfg } = configuration();
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret: jwtCfg.accessSecret });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { status: true, tokenVersion: true },
      });
      if (!user || user.status !== 'active' || user.tokenVersion !== payload.tv) return null;

      if (payload.sid) {
        const session = await this.prisma.refreshToken.findUnique({
          where: { id: payload.sid },
          select: { revokedAt: true },
        });
        if (!session || session.revokedAt) return null;
      }

      return payload.sub;
    } catch {
      return null;
    }
  }

  /** Broadcasts to every connected (already-authenticated) socket. Returns how many were reached. */
  broadcastTest(payload: TestNotificationPayload): number {
    this.server.emit('test-notification', payload);
    return this.server.sockets.sockets.size;
  }
}
