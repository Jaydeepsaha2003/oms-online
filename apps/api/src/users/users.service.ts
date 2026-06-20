import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { type Paginated, type UserDto, type UserStatus } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';

const USER_INCLUDE = { roles: { include: { role: true } } } satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
