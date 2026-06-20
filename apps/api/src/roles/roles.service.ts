import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type RoleDto, SUPER_ADMIN_ROLE } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const ROLE_INCLUDE = {
  permissions: { include: { permission: true } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleInclude;
type RoleRow = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<RoleDto[]> {
    const rows = await this.prisma.role.findMany({
      include: ROLE_INCLUDE,
      orderBy: [{ isSystem: 'desc' }, { label: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async findOne(id: string): Promise<RoleDto> {
    const role = await this.prisma.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
    if (!role) throw new NotFoundException('Role not found.');
    return this.toDto(role);
  }

  async create(dto: CreateRoleDto): Promise<RoleDto> {
    const permissionIds = await this.resolvePermissionIds(dto.permissions);
    try {
      const role = await this.prisma.role.create({
        data: {
          name: dto.name,
          label: dto.label,
          description: dto.description,
          isSystem: false,
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
        include: ROLE_INCLUDE,
      });
      return this.toDto(role);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A role with this name already exists.');
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleDto> {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found.');

    // The super admin role is always all-powerful; its permission set is not editable.
    if (role.name === SUPER_ADMIN_ROLE && dto.permissions) {
      throw new ForbiddenException('The super admin role grants all permissions and cannot be narrowed.');
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.role.update({
        where: { id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
      }),
    ];

    if (dto.permissions) {
      const permissionIds = await this.resolvePermissionIds(dto.permissions);
      ops.push(this.prisma.rolePermission.deleteMany({ where: { roleId: id } }));
      ops.push(
        this.prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        }),
      );
    }

    await this.prisma.$transaction(ops);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted.');
    await this.prisma.role.delete({ where: { id } });
  }

  /** Map permission keys to ids, ignoring unknown keys. */
  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    if (!keys.length) return [];
    const found = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });
    return found.map((p) => p.id);
  }

  private toDto(role: RoleRow): RoleDto {
    return {
      id: role.id,
      name: role.name,
      label: role.label,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.permissions.map((rp) => rp.permission.key),
      userCount: role._count.users,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }
}
