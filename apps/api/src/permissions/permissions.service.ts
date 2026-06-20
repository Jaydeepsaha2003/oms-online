import { Injectable } from '@nestjs/common';
import { type PermissionDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<PermissionDto[]> {
    const rows = await this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      resource: r.resource,
      action: r.action,
      label: r.label,
      group: r.group,
    }));
  }
}
