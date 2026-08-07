import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPROVAL_TYPE_LABELS,
  type ApprovalListResult,
  type ApprovalQuery,
  type ApprovalRequestDto,
  type ApprovalStatus,
  type ApprovalType,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Row shape used internally; matches the ApprovalRequest model. */
type Row = Prisma.ApprovalRequestGetPayload<object>;

/**
 * Replays an approved request against the real tables. Registered per approval
 * `type` by the module that owns that action, which keeps this service free of
 * dependencies on every feature that might need a sign-off.
 *
 * Returns the id of whatever it created (stored as `resultId` for traceability),
 * or null when the action produces nothing addressable.
 */
/** Applies an approved request. `approver` is optional so handlers that don't
 *  care about who signed off keep compiling unchanged. */
export type ApprovalHandler = (
  payload: Record<string, unknown>,
  approverName: string,
  approver?: { id?: string | null; name: string },
) => Promise<number | null>;

/**
 * Where an approval's decision should ALSO be logged, beyond the generic
 * `approval` resource entry every decision already gets — e.g. a dispatch
 * back-date's approval is far more useful sitting inside THAT DISPATCH's own
 * Activity History than buried under a separate "approval" resource nobody
 * browsing that record would think to look at.
 */
export interface ApprovalAuditTarget {
  /** The RESOURCES value to attach the decision entry to, e.g. 'dispatch'. */
  resource: string;
  /** A short label for the description, e.g. "back-dated dispatch". */
  label: string;
  /** One line summarising the request's own content (qty, dates, etc.), shown
   *  in the decision's audit description. */
  describe: (payload: Record<string, unknown>) => string;
  /**
   * The id of an ALREADY-EXISTING record this request concerns, if any — used to
   * attach a REJECTION to that record's history (nothing new was created to
   * attach it to otherwise). Return null when the request creates a brand-new
   * record on approval and nothing exists yet to reject "into".
   */
  existingResourceId?: (payload: Record<string, unknown>) => number | null;
}

/**
 * The universal approvals inbox.
 *
 * A request is a *pending action*, not a half-written record: the payload sits
 * here as JSON and is only executed when approved. That's why no other query in
 * the system needs to know about approval state — an unapproved dispatch simply
 * does not exist in the Dispatch table yet.
 */
@Injectable()
export class ApprovalsService {
  private readonly handlers = new Map<string, ApprovalHandler>();
  private readonly auditTargets = new Map<string, ApprovalAuditTarget>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Register where a type's decisions should ALSO be logged — see {@link ApprovalAuditTarget}. */
  registerAuditTarget(type: ApprovalType | string, target: ApprovalAuditTarget): void {
    this.auditTargets.set(type, target);
  }

  /**
   * Register the replay handler for one approval type. Called from a feature
   * module's `onModuleInit` so the wiring lives next to the action it performs.
   */
  registerHandler(type: ApprovalType | string, handler: ApprovalHandler): void {
    this.handlers.set(type, handler);
  }

  /** Raise a request for an action the user wasn't allowed to perform outright. */
  async request(input: {
    type: ApprovalType | string;
    title: string;
    summary?: string | null;
    payload: Record<string, unknown>;
    entity?: string | null;
    entityId?: number | null;
    requestedById?: string | null;
    requestedByName?: string | null;
  }): Promise<ApprovalRequestDto> {
    const row = await this.prisma.approvalRequest.create({
      data: {
        type: input.type,
        title: input.title,
        summary: input.summary ?? null,
        payload: JSON.stringify(input.payload ?? {}),
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        requestedById: input.requestedById ?? null,
        requestedByName: input.requestedByName ?? null,
      },
    });
    return this.toDto(await this.ensureCode(row));
  }

  async list(query: ApprovalQuery): Promise<ApprovalListResult> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const status = query.status && query.status !== 'ALL' ? query.status : undefined;

    const where: Prisma.ApprovalRequestWhereInput = {};
    if (status) where.status = status;
    if (query.type) where.type = query.type;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { summary: { contains: search } },
        { code: { contains: search } },
        { requestedByName: { contains: search } },
      ];
    }

    const [rows, total, pendingTotal] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        // Oldest pending first — an approvals queue is worked front to back — but
        // decided rows read newest-first, which is how you check recent history.
        orderBy: status === 'PENDING' ? [{ requestedAt: 'asc' }] : [{ requestedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.approvalRequest.count({ where }),
      this.prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      pendingTotal,
    };
  }

  /** Just the badge number, so the sidebar can poll something cheap. */
  async pendingCount(): Promise<{ pending: number }> {
    return { pending: await this.prisma.approvalRequest.count({ where: { status: 'PENDING' } }) };
  }

  async byId(id: number): Promise<ApprovalRequestDto> {
    const row = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Approval request not found.');
    return this.toDto(row);
  }

  /**
   * Approve a request: run its handler, then mark it approved. The handler runs
   * FIRST — if creating the real record fails, the request stays PENDING rather
   * than being marked done with nothing to show for it.
   */
  async approve(id: number, approver: { id?: string | null; name: string }, note?: string): Promise<ApprovalRequestDto> {
    const row = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Approval request not found.');
    if (row.status !== 'PENDING') throw new BadRequestException(`This request was already ${row.status.toLowerCase()}.`);

    const handler = this.handlers.get(row.type);
    if (!handler) {
      throw new BadRequestException(`Nothing in this build knows how to apply a "${row.type}" approval.`);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('This request’s saved details are unreadable, so it cannot be applied.');
    }

    const resultId = await handler(payload, approver.name, approver);

    const saved = await this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        decidedById: approver.id ?? null,
        decidedByName: approver.name,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
        resultId,
      },
    });

    // A dispatch back-date's approval is far more findable sitting inside THAT
    // dispatch's own Activity History than under the generic 'approval' resource.
    const target = this.auditTargets.get(row.type);
    if (target && resultId != null) {
      void this.audit.record({
        userId: approver.id ?? null,
        action: 'approve',
        resource: target.resource,
        resourceId: String(resultId),
        description: `Approved ${target.label} requested by ${row.requestedByName ?? 'someone'} — ${target.describe(payload)}${note?.trim() ? ` · note: ${note.trim()}` : ''}`,
        statusCode: 200,
      });
    }
    return this.toDto(saved);
  }

  /** Reject a request. A note is required so the requester learns why. */
  async reject(id: number, approver: { id?: string | null; name: string }, note?: string): Promise<ApprovalRequestDto> {
    const reason = note?.trim();
    if (!reason) throw new BadRequestException('Add a short reason so the requester knows why this was rejected.');

    const row = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Approval request not found.');
    if (row.status !== 'PENDING') throw new BadRequestException(`This request was already ${row.status.toLowerCase()}.`);

    const saved = await this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        decidedById: approver.id ?? null,
        decidedByName: approver.name,
        decidedAt: new Date(),
        decisionNote: reason,
      },
    });

    // Only attach a rejection entry to an EXISTING record's history — a rejected
    // back-dated dispatch never existed in the first place, so there's nothing to
    // attach it to (the general 'approval' resource entry still covers it).
    const target = this.auditTargets.get(row.type);
    if (target?.existingResourceId) {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        /* malformed payload — describe() below just gets an empty object */
      }
      const existingId = target.existingResourceId(payload);
      if (existingId != null) {
        void this.audit.record({
          userId: approver.id ?? null,
          action: 'reject',
          resource: target.resource,
          resourceId: String(existingId),
          description: `Rejected ${target.label} requested by ${row.requestedByName ?? 'someone'} — ${target.describe(payload)} · reason: ${reason}`,
          statusCode: 200,
        });
      }
    }
    return this.toDto(saved);
  }

  async remove(id: number): Promise<void> {
    const count = await this.prisma.approvalRequest.count({ where: { id } });
    if (!count) throw new NotFoundException('Approval request not found.');
    await this.prisma.approvalRequest.delete({ where: { id } });
  }

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  private codeFor(id: number): string {
    return `APR-${String(id).padStart(5, '0')}`;
  }

  /** The human code needs the row's id, so it's stamped straight after insert. */
  private async ensureCode(row: Row): Promise<Row> {
    if (row.code) return row;
    return this.prisma.approvalRequest.update({ where: { id: row.id }, data: { code: this.codeFor(row.id) } });
  }

  private toDto(r: Row): ApprovalRequestDto {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      /* leave empty — a corrupt payload shouldn't break the whole list */
    }
    return {
      id: r.id,
      code: r.code ?? this.codeFor(r.id),
      type: r.type,
      typeLabel: APPROVAL_TYPE_LABELS[r.type as ApprovalType] ?? r.type,
      status: r.status as ApprovalStatus,
      title: r.title,
      summary: r.summary,
      payload,
      entity: r.entity,
      entityId: r.entityId,
      requestedByName: r.requestedByName,
      requestedAt: r.requestedAt.toISOString(),
      decidedByName: r.decidedByName,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionNote: r.decisionNote,
      resultId: r.resultId,
    };
  }
}
