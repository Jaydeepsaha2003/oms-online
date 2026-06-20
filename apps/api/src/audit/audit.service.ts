import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type AuditLogDto,
  type AuditLogList,
  type AuditLogQuery,
  DEFAULT_PAGE_SIZE,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAuditInput {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  description?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist an audit entry. Never throws — auditing must not break the request
   * it is recording. Returns void; callers may fire-and-forget.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId ?? null,
          userEmail: input.userEmail ?? null,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId ?? null,
          description: input.description ?? null,
          method: input.method ?? null,
          path: input.path ?? null,
          statusCode: input.statusCode ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write audit log: ${(err as Error).message}`);
    }
  }

  async findMany(query: AuditLogQuery): Promise<AuditLogList> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resource ? { resource: query.resource } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search } },
              { userEmail: { contains: query.search } },
              { resourceId: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((r): AuditLogDto => ({
        id: r.id,
        userId: r.userId,
        userEmail: r.userEmail,
        action: r.action,
        resource: r.resource,
        resourceId: r.resourceId,
        description: r.description,
        method: r.method,
        path: r.path,
        statusCode: r.statusCode,
        ip: r.ip,
        userAgent: r.userAgent,
        metadata: parseMetadata(r.metadata),
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}

/** Safely parse a JSON-serialized metadata column back into an object. */
function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
