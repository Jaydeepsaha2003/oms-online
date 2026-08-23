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
      return;
    }
    // The connection already proves who this is; keep it so a notification can
    // be addressed to particular people instead of everyone. One room per user
    // (rather than per permission) means a role change takes effect on the next
    // send, with no need to re-shuffle live sockets.
    client.data.userId = userId;
    await client.join(NotificationsGateway.userRoom(userId));
  }

  /** Socket.IO room carrying every live connection belonging to one user. */
  private static userRoom(userId: string): string {
    return `user:${userId}`;
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

  /**
   * Sends the test chime to ONE user's own live connections.
   *
   * This used to be `server.emit(...)` — every authenticated socket in the
   * company, from an endpoint with no permission on it at all. So any signed-in
   * user, including a dispatch-only operator, could ring a native notification
   * and a chime on every other person's phone; and because it was the one path
   * that ignored the audience service entirely, it was also the one path by
   * which someone could be alerted about a screen they cannot open.
   *
   * A test answers "does MY device work", so the caller's own room is the
   * correct audience and no permission is needed — it can only reach yourself.
   */
  testToUser(userId: string, payload: TestNotificationPayload): number {
    this.server.to(NotificationsGateway.userRoom(userId)).emit('test-notification', payload);

    let reached = 0;
    for (const socket of this.server.sockets.sockets.values()) {
      if (socket.data.userId === userId) reached += 1;
    }
    return reached;
  }

  /**
   * Same notification, delivered only to the given users' live sockets.
   *
   * Returns how many connections were reached, counted from the rooms rather
   * than assumed — a listed user with nothing open simply contributes zero.
   */
  notifyUsers(userIds: string[], notification: { title: string; body: string; data?: Record<string, unknown> }): number {
    if (!userIds.length) return 0;
    const rooms = userIds.map((id) => NotificationsGateway.userRoom(id));
    this.server.to(rooms).emit('notification', notification);

    let reached = 0;
    for (const socket of this.server.sockets.sockets.values()) {
      if (userIds.includes(socket.data.userId as string)) reached += 1;
    }
    return reached;
  }

  /** Silent data-changed ping: tells every open client the un-challaned pool moved
   *  (a challan was created/updated/cancelled/deleted) so their Pending Challan view
   *  re-fetches live. No toast/sound — the client just invalidates its query. */
  emitPendingChallansChanged(): number {
    this.server.emit('challans:pending-changed');
    return this.server.sockets.sockets.size;
  }

  /** Silent data-changed ping: a Dispatch Order line's soft edit-lock was
   *  acquired or released, so every open Pending Dispatch view re-fetches and
   *  shows/clears that line's "being dispatched by X" state live, instead of
   *  only finding out when someone else tries to open it themselves. */
  emitDispatchLockChanged(): number {
    this.server.emit('dispatch:lock-changed');
    return this.server.sockets.sockets.size;
  }
}
