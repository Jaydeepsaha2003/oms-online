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
    const verified = token ? await this.verifyToken(token) : null;
    if (!verified) {
      client.disconnect(true);
      return;
    }
    const { userId, sid } = verified;
    // The connection already proves who this is; keep it so a notification can
    // be addressed to particular people instead of everyone. One room per user
    // (rather than per permission) means a role change takes effect on the next
    // send, with no need to re-shuffle live sockets.
    client.data.userId = userId;
    // Kept so a forced sign-out can target the exact devices being kicked and
    // leave the one that just signed in alone (see forceSignOut).
    client.data.sid = sid ?? null;
    await client.join(NotificationsGateway.userRoom(userId));
  }

  /**
   * Tell the given sessions they've been signed out, and drop their sockets.
   *
   * Used when a fresh login displaces a user's other devices. The `sid` check in
   * JwtStrategy already blocks their next HTTP request, but an idle tab makes no
   * requests — it would sit on a stale screen until something happened to poke
   * it. Pushing here is what makes the logout immediate rather than eventual.
   */
  forceSignOut(userId: string, sids: string[]): number {
    if (!sids.length) return 0;
    const targets = new Set(sids);
    let kicked = 0;
    for (const socket of this.server.sockets.sockets.values()) {
      if (socket.data.userId !== userId) continue;
      const sid = socket.data.sid as string | null | undefined;
      // No sid on the socket (an older token) can't be told apart from the new
      // session, so leave it — its next request gets rejected anyway.
      if (!sid || !targets.has(sid)) continue;
      socket.emit('auth:signed-out', { reason: 'SIGNED_IN_ELSEWHERE' });
      socket.disconnect(true);
      kicked += 1;
    }
    return kicked;
  }

  /** Socket.IO room carrying every live connection belonging to one user. */
  private static userRoom(userId: string): string {
    return `user:${userId}`;
  }

  /** Same checks as JwtStrategy.validate: active user, current token version, session not revoked. */
  private async verifyToken(token: string): Promise<{ userId: string; sid?: string } | null> {
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

      return { userId: payload.sub, sid: payload.sid };
    } catch {
      return null;
    }
  }

  /** Broadcasts to every connected (already-authenticated) socket. Returns how many were reached. */
  broadcastTest(payload: TestNotificationPayload): number {
    this.server.emit('test-notification', payload);
    return this.server.sockets.sockets.size;
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
}
