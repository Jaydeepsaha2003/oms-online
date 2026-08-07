import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, type Paginated, type UserDto, type UserStatus } from '@oms/shared';
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

    return {
      items: rows.map((r) => this.toDto(r)),
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

  async create(dto: CreateUserDto): Promise<UserDto> {
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

  async update(id: string, dto: UpdateUserDto): Promise<UserDto> {
    await this.ensureExists(id);
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

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
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
    this.assertMayManage(target, actor);

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
  private assertMayManage(target: UserRow, actor: AuthenticatedUser): void {
    if (actor.permissions.includes(ALL_PERMISSIONS)) return;
    const mine = new Set(actor.roles);
    const beyond = target.roles.map((ur) => ur.role).filter((r) => !mine.has(r.name));
    if (beyond.length) {
      throw new ForbiddenException(
        `You cannot set the password of a user holding ${beyond.map((r) => r.label).join(', ')} — that role outranks yours.`,
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

  private toDto(u: UserRow): UserDto {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status as UserStatus,
      roles: u.roles.map((ur) => ({ id: ur.role.id, name: ur.role.name, label: ur.role.label })),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
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
