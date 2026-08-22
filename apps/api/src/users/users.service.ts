import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, hasPermission, type Paginated, type UserDto, type UserStatus } from '@oms/shared';
import { SessionsService } from '../auth/sessions.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';

const USER_INCLUDE = { roles: { include: { role: true } } } satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    // Reused so an admin-set password kills sessions exactly the way
    // "sign out everywhere" already does — one implementation, not two.
    private readonly sessions: SessionsService,
  ) {}

  async findMany(query: UserQueryDto): Promise<Paginated<UserDto>> {
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { email: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    const presence = await this.presenceFor(rows.map((r) => r.id));

    return {
      items: rows.map((r) => this.toDto(r, presence.get(r.id))),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!user) throw new NotFoundException('User not found.');
    return this.toDto(user);
  }

  async create(dto: CreateUserDto, actor: AuthenticatedUser): Promise<UserDto> {
    await this.assertMayGrant(dto.roleIds, actor);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          passwordHash,
          status: dto.status ?? 'active',
          roles: { create: dto.roleIds.map((roleId) => ({ roleId })) },
        },
        include: USER_INCLUDE,
      });
      return this.toDto(user);
    } catch (err) {
      throw this.translate(err, 'A user with this email already exists.');
    }
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser): Promise<UserDto> {
    const target = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!target) throw new NotFoundException('User not found.');
    // Both halves are needed: you may not edit someone who outranks you, and you
    // may not hand out a role you don't hold (including to yourself).
    await this.assertMayManage(target, actor);
    if (dto.roleIds) await this.assertMayGrant(dto.roleIds, actor);
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      }),
    ];
    if (dto.roleIds) {
      ops.push(this.prisma.userRole.deleteMany({ where: { userId: id } }));
      ops.push(
        this.prisma.userRole.createMany({
          data: [...new Set(dto.roleIds)].map((roleId) => ({ userId: id, roleId })),
        }),
      );
    }
    await this.prisma.$transaction(ops);
    return this.findOne(id);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!target) throw new NotFoundException('User not found.');
    // Deleting an account that outranks you is escalation by another route:
    // remove the Super Administrator, then re-create one you control.
    await this.assertMayManage(target, actor, 'delete');
    await this.prisma.user.delete({ where: { id } });
  }

  /**
   * Set another user's password — the forgotten-password path.
   *
   * An existing password can never be read back (bcrypt is one-way), so recovery
   * can only mean replacing it. Every session is then killed: `tokenVersion` is
   * bumped, which invalidates outstanding access tokens, and the refresh tokens
   * are revoked. Otherwise a device already signed in would keep working with
   * the password its owner no longer knows.
   *
   * Guarded against privilege escalation — see {@link assertMayManage}.
   */
  async setPassword(id: string, password: string, actor: AuthenticatedUser): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!target) throw new NotFoundException('User not found.');
    await this.assertMayManage(target, actor);

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    // Bump tokenVersion + revoke refresh tokens (same effect as "sign out everywhere").
    await this.sessions.revokeAll(id);
  }

  /**
   * Refuse to touch an account that holds a role the actor does not.
   *
   * Without this, `user:manage` would be a hand-over of the whole system: an
   * Administrator could set the Super Administrator's password and sign in as
   * them. A super admin carries the `*` wildcard and so passes for everyone.
   */
  private async assertMayManage(target: UserRow, actor: AuthenticatedUser, verb = 'modify'): Promise<void> {
    if (actor.permissions.includes(ALL_PERMISSIONS)) return;
    const beyond = await this.rolesBeyond(
      target.roles.map((ur) => ur.role.id),
      actor,
    );
    if (beyond.length) {
      throw new ForbiddenException(
        `You cannot ${verb} a user holding ${beyond.map((r) => r.label).join(', ')} — that role outranks yours.`,
      );
    }
  }

  /**
   * Which of these roles outrank the actor — judged ONLY on the permissions that
   * could actually hand someone more power than they started with.
   *
   * Two models were tried and both were wrong for this app:
   *
   *  - by role NAME (`target.roles ⊄ actor.roles`): treats every *different*
   *    role as superior, so an Administrator was refused on an Operator.
   *  - by full permission superset: the roles here are job functions, not nested
   *    tiers. Operator holds dispatch permissions an Administrator doesn't, so
   *    Operator "outranked" Administrator and admins still couldn't manage staff
   *    or reset their passwords — the bug this was meant to fix.
   *
   * What actually matters is narrow: `*`, and the user/role administration
   * permissions. Those are the ones that let you mint a stronger account or
   * rewrite a role definition. Ordinary operational permissions (dispatch,
   * orders, challans) can't escalate anything, so holding them must not make an
   * account untouchable by the person whose job is managing accounts.
   */
  private async rolesBeyond(roleIds: string[], actor: AuthenticatedUser): Promise<{ label: string }[]> {
    if (!roleIds.length) return [];
    const escalating = (key: string) => key === ALL_PERMISSIONS || key.startsWith('user:') || key.startsWith('role:');
    const roles = await this.prisma.role.findMany({
      where: { id: { in: [...new Set(roleIds)] } },
      include: { permissions: { include: { permission: true } } },
    });
    return roles.filter((r) =>
      r.permissions.some((rp) => escalating(rp.permission.key) && !hasPermission(actor.permissions, rp.permission.key)),
    );
  }

  /**
   * Refuse to GRANT a role the actor does not hold themselves.
   *
   * This is the other half of {@link assertMayManage}, and the bigger hole of
   * the two: guarding only the password path still let an Administrator hand
   * themselves (or anyone else) the Super Administrator role outright and pick
   * up all 234 permissions — no password reset needed. `user:manage` is meant to
   * be "run the user list", not "promote yourself past your own ceiling".
   */
  private async assertMayGrant(roleIds: string[], actor: AuthenticatedUser): Promise<void> {
    if (actor.permissions.includes(ALL_PERMISSIONS)) return;
    const beyond = await this.rolesBeyond(roleIds, actor);
    if (beyond.length) {
      throw new ForbiddenException(
        `You cannot assign ${beyond.map((r) => r.label).join(', ')} — it grants permissions you don't have yourself.`,
      );
    }
  }

  /** Flattened rows for Excel export. */
  async exportRows(query: UserQueryDto): Promise<Record<string, unknown>[]> {
    const { items } = await this.findMany({ ...query, page: 1, pageSize: 10_000 } as UserQueryDto);
    return items.map((u) => ({
      Email: u.email,
      Name: u.name,
      Status: u.status,
      Roles: u.roles.map((r) => r.label).join(', '),
      'Last login': u.lastLoginAt ?? '',
      Created: u.createdAt,
    }));
  }

  private async ensureExists(id: string): Promise<void> {
    const count = await this.prisma.user.count({ where: { id } });
    if (!count) throw new NotFoundException('User not found.');
  }

  /**
   * "Is this person actually using the system?" for a page of users, in two
   * queries rather than two per user.
   *
   * Activity comes from the audit log — every action a user takes writes one,
   * so its newest entry is the truest cheap signal of real use. Sessions come
   * from refresh tokens that are neither revoked nor expired. Account status is
   * deliberately NOT folded in: an Active account nobody has touched in a month
   * is exactly the distinction this exists to show.
   */
  private async presenceFor(ids: string[]): Promise<Map<string, { lastActiveAt: Date | null; activeSessions: number }>> {
    const out = new Map<string, { lastActiveAt: Date | null; activeSessions: number }>();
    if (!ids.length) return out;
    const now = new Date();
    const [acts, sessions] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { createdAt: true } }),
      this.prisma.refreshToken.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, revokedAt: null, expiresAt: { gt: now } },
        _count: { _all: true },
      }),
    ]);
    for (const id of ids) out.set(id, { lastActiveAt: null, activeSessions: 0 });
    for (const a of acts) {
      if (a.userId && out.has(a.userId)) out.get(a.userId)!.lastActiveAt = a._max.createdAt ?? null;
    }
    for (const s of sessions) {
      if (out.has(s.userId)) out.get(s.userId)!.activeSessions = s._count._all;
    }
    return out;
  }

  private toDto(u: UserRow, presence?: { lastActiveAt: Date | null; activeSessions: number }): UserDto {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status as UserStatus,
      roles: u.roles.map((ur) => ({ id: ur.role.id, name: ur.role.name, label: ur.role.label })),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      lastActiveAt: presence?.lastActiveAt?.toISOString() ?? null,
      activeSessions: presence?.activeSessions ?? 0,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }

  private translate(err: unknown, conflictMessage: string): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return new ConflictException(conflictMessage);
      if (err.code === 'P2025') return new NotFoundException('Record not found.');
    }
    return err as Error;
  }
}
