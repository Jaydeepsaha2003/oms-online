import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Task, TaskEvent, TaskFile } from '@prisma/client';
import {
  ACTIONS,
  hasPermission,
  perm,
  RESOURCES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type CreateTaskInput,
  type TaskDetailDto,
  type TaskFileDto,
  type TaskListDto,
  type TaskPersonDto,
  type TaskSummaryDto,
  type UpdateTaskInput,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { flattenAccess, USER_ACCESS_INCLUDE } from '../auth/user-access.util';
import { ensureUploadDir, UPLOADS_DIR } from '../uploads/uploads.constants';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PushService } from '../notifications/push.service';

/** The right to mark a task complete — the "developer" of the tracker. */
export const TASK_APPROVE = perm(RESOURCES.TASK, ACTIONS.APPROVE);
export const MAX_TASK_FILE_BYTES = 25 * 1024 * 1024;
/** A dot-folder: the static /api/uploads handler never serves it, so a file
 *  only leaves through the signed-in download route. */
const FILES_SUBDIR = '.task-files';

const key = (t: Pick<Task, 'type' | 'id'>) => `${t.type === 'bug' ? 'BUG' : 'TSK'}-${t.id}`;
const ids = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const fileDto = (f: TaskFile): TaskFileDto => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  size: f.size,
  uploadedById: f.uploadedById,
  createdAt: f.createdAt.toISOString(),
});

function text(v: unknown, field: string, max: number, required = false): string {
  if (v == null) {
    if (required) throw new BadRequestException(`${field} is required.`);
    return '';
  }
  if (typeof v !== 'string') throw new BadRequestException(`${field} must be text.`);
  const s = v.trim();
  if (required && !s) throw new BadRequestException(`${field} is required.`);
  if (s.length > max) throw new BadRequestException(`${field} is longer than ${max} characters.`);
  return s;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new BadRequestException(`${field} must be one of: ${allowed.join(', ')}.`);
  return v as T;
}

/**
 * Tasks & Bugs for OMS and WMS: anyone signed in reports one, moves it along,
 * hands it to someone and talks about it; every change lands in the thread.
 * Only "done" is withheld — that is `task:approve`, through complete().
 */
@Injectable()
export class TasksService {
  private readonly log = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly push: PushService,
  ) {}

  private async people(): Promise<TaskPersonDto[]> {
    const users = await this.prisma.user.findMany({ where: { status: 'active' }, include: USER_ACCESS_INCLUDE, orderBy: { name: 'asc' } });
    return users.map((u) => ({ id: u.id, name: u.name, isDeveloper: hasPermission(flattenAccess(u).permissions, TASK_APPROVE) }));
  }

  private summary(t: Task, messageCount: number, fileCount: number): TaskSummaryDto {
    return {
      id: t.id,
      key: key(t),
      app: t.app === 'WMS' ? 'WMS' : 'OMS',
      type: t.type === 'bug' ? 'bug' : 'task',
      title: t.title,
      area: t.area,
      priority: oneOf(t.priority, TASK_PRIORITIES, 'Priority'),
      status: oneOf(t.status, TASK_STATUSES, 'Status'),
      reporterId: t.reporterId,
      assigneeIds: ids(t.assigneeIds),
      messageCount,
      fileCount,
      doneAt: iso(t.doneAt),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private async load(id: number): Promise<Task> {
    const t = await this.prisma.task.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Task not found.');
    return t;
  }

  /** Each to be an active user; at most 20, no repeats. */
  private async assignees(v: unknown): Promise<string[]> {
    if (!Array.isArray(v)) throw new BadRequestException('Assignees must be a list of user ids.');
    const list = [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))];
    if (list.length > 20) throw new BadRequestException('A task can have at most 20 people.');
    const active = await this.prisma.user.count({ where: { id: { in: list }, status: 'active' } });
    if (active !== list.length) throw new BadRequestException('That person cannot be assigned.');
    return list;
  }

  private event(taskId: number, userId: string, kind: string, data: Record<string, unknown> = {}, body = '') {
    return this.prisma.taskEvent.create({ data: { taskId, userId, kind, text: body, data: JSON.stringify(data) } });
  }

  /** A courtesy on top of the change: a push service that is down must not
   *  turn a saved comment into an error the person retries. */
  private notify(t: Task, to: (string | null)[], by: AuthenticatedUser, title: string, body?: string) {
    const users = [...new Set(to.filter((x): x is string => !!x && x !== by.id))];
    if (!users.length) return;
    const n = { title: `${key(t)} · ${title}`, body: body || t.title, data: { kind: 'task', url: `/tasks/${t.id}` } };
    this.gateway.notifyUsers(users, n);
    this.push.sendToUsers(users, n).catch((err) => this.log.warn(`task notification failed: ${String(err)}`));
  }

  async list(me: AuthenticatedUser): Promise<TaskListDto> {
    const [tasks, people] = await Promise.all([
      this.prisma.task.findMany({ include: { _count: { select: { files: true } }, events: { where: { kind: 'comment' }, select: { id: true } } } }),
      this.people(),
    ]);
    return {
      tasks: tasks.map((t) => this.summary(t, t.events.length, t._count.files)),
      people,
      me: { id: me.id, isDeveloper: hasPermission(me.permissions, TASK_APPROVE) },
    };
  }

  async get(id: number): Promise<TaskDetailDto> {
    const t = await this.load(id);
    const [events, files] = await Promise.all([
      this.prisma.taskEvent.findMany({ where: { taskId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.taskFile.findMany({ where: { taskId: id }, orderBy: { id: 'asc' } }),
    ]);
    const byEvent = new Map<number, TaskFileDto[]>();
    for (const f of files) if (f.eventId) byEvent.set(f.eventId, [...(byEvent.get(f.eventId) ?? []), fileDto(f)]);
    return {
      ...this.summary(t, events.filter((e) => e.kind === 'comment').length, files.length),
      description: t.description,
      steps: ids(t.steps),
      doneById: t.doneById,
      resolution: t.resolution,
      files: files.filter((f) => !f.eventId).map(fileDto),
      events: events.map((e: TaskEvent) => ({
        id: e.id,
        userId: e.userId,
        kind: e.kind,
        text: e.text,
        data: JSON.parse(e.data || '{}') as Record<string, unknown>,
        files: byEvent.get(e.id) ?? [],
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async create(input: CreateTaskInput, me: AuthenticatedUser): Promise<TaskDetailDto> {
    const type = oneOf(input.type, ['bug', 'task'] as const, 'Type');
    const title = text(input.title, 'Title', 200, true);
    if (title.length < 4) throw new BadRequestException('Title must be at least 4 characters.');
    const assigneeIds = await this.assignees(input.assigneeIds ?? []);
    const steps = type === 'bug' && Array.isArray(input.steps) ? input.steps.map((s) => String(s).trim().slice(0, 500)).filter(Boolean).slice(0, 30) : [];
    const t = await this.prisma.task.create({
      data: {
        app: oneOf(input.app, ['OMS', 'WMS'] as const, 'App'),
        type,
        title,
        description: text(input.description, 'Description', 20000),
        steps: JSON.stringify(steps),
        area: text(input.area, 'Area', 60, true),
        priority: input.priority === undefined ? 'medium' : oneOf(input.priority, TASK_PRIORITIES, 'Priority'),
        reporterId: me.id,
        assigneeIds: JSON.stringify(assigneeIds),
      },
    });
    await this.event(t.id, me.id, 'created', { type });
    for (const to of assigneeIds) await this.event(t.id, me.id, 'assigned', { to });
    if (assigneeIds.length) this.notify(t, assigneeIds, me, `${me.name} assigned you a ${type}`);
    else {
      // Nobody picked yet: tell whoever can close it that there is something to pick up.
      const devs = (await this.people()).filter((p) => p.isDeveloper).map((p) => p.id);
      this.notify(t, devs, me, `New ${type} from ${me.name}`);
    }
    return this.get(t.id);
  }

  async update(id: number, input: UpdateTaskInput, me: AuthenticatedUser): Promise<TaskDetailDto> {
    const t = await this.load(id);
    const data: Partial<Task> = {};
    const events: { kind: string; data: Record<string, unknown> }[] = [];
    if (input.title !== undefined) {
      const title = text(input.title, 'Title', 200, true);
      if (title.length < 4) throw new BadRequestException('Title must be at least 4 characters.');
      if (title !== t.title) (data.title = title), events.push({ kind: 'edited', data: { field: 'title' } });
    }
    if (input.description !== undefined) {
      const d = text(input.description, 'Description', 20000);
      if (d !== t.description) (data.description = d), events.push({ kind: 'edited', data: { field: 'description' } });
    }
    if (input.area !== undefined) {
      const area = text(input.area, 'Area', 60, true);
      if (area !== t.area) (data.area = area), events.push({ kind: 'area', data: { from: t.area, to: area } });
    }
    if (input.priority !== undefined) {
      const p = oneOf(input.priority, TASK_PRIORITIES, 'Priority');
      if (p !== t.priority) (data.priority = p), events.push({ kind: 'priority', data: { from: t.priority, to: p } });
    }
    if (input.status !== undefined) {
      const st = oneOf(input.status, TASK_STATUSES, 'Status');
      if (st === 'done' && t.status !== 'done') throw new BadRequestException('Use "Mark as complete" to close a task.');
      if (st !== t.status) {
        Object.assign(data, { status: st }, t.status === 'done' ? { doneById: null, doneAt: null } : {});
        events.push({ kind: 'status', data: { from: t.status, to: st } });
      }
    }
    let added: string[] = [];
    if (input.assigneeIds !== undefined) {
      const was = ids(t.assigneeIds);
      const wanted = await this.assignees(input.assigneeIds);
      added = wanted.filter((x) => !was.includes(x));
      const removed = was.filter((x) => !wanted.includes(x));
      if (added.length || removed.length) {
        data.assigneeIds = JSON.stringify([...was.filter((x) => wanted.includes(x)), ...added]);
        for (const from of removed) events.push({ kind: 'unassigned', data: { from } });
        for (const to of added) events.push({ kind: 'assigned', data: { to } });
      }
    }
    if (!events.length) return this.get(id);
    const saved = await this.prisma.task.update({ where: { id }, data });
    for (const e of events) await this.event(id, me.id, e.kind, e.data);
    if (added.length) this.notify(saved, added, me, `${me.name} assigned you a ${saved.type}`);
    return this.get(id);
  }

  async complete(id: number, input: { resolution?: unknown; notify?: unknown }, me: AuthenticatedUser): Promise<TaskDetailDto> {
    if (!hasPermission(me.permissions, TASK_APPROVE)) throw new ForbiddenException('Only a developer can mark a task as complete.');
    const t = await this.load(id);
    if (t.status === 'done') return this.get(id);
    const resolution = text(input.resolution, 'Resolution', 5000) || null;
    const saved = await this.prisma.task.update({ where: { id }, data: { status: 'done', doneById: me.id, doneAt: new Date(), resolution } });
    await this.event(id, me.id, 'completed', {}, resolution ?? '');
    if (input.notify !== false) this.notify(saved, [t.reporterId], me, `Done by ${me.name}`, resolution ?? t.title);
    return this.get(id);
  }

  async reopen(id: number, me: AuthenticatedUser): Promise<TaskDetailDto> {
    const t = await this.load(id);
    if (t.status !== 'done') return this.get(id);
    const saved = await this.prisma.task.update({ where: { id }, data: { status: 'open', doneById: null, doneAt: null } });
    await this.event(id, me.id, 'reopened');
    this.notify(saved, [...ids(t.assigneeIds), t.doneById], me, `Reopened by ${me.name}`);
    return this.get(id);
  }

  /** Returns the new event's id, so the composer can attach its files to it. */
  async comment(id: number, input: { text?: unknown; withFiles?: unknown }, me: AuthenticatedUser): Promise<{ eventId: number }> {
    const t = await this.load(id);
    const body = text(input.text, 'Message', 10000);
    if (!body && input.withFiles !== true) throw new BadRequestException('Write a message or attach a file.');
    const e = await this.event(id, me.id, 'comment', {}, body);
    await this.prisma.task.update({ where: { id }, data: { updatedAt: new Date() } });
    this.notify(t, [t.reporterId, ...ids(t.assigneeIds)], me, `${me.name} replied`, body.slice(0, 140) || 'sent a file');
    return { eventId: e.id };
  }

  async addFile(id: number, eventId: number | null, file: Express.Multer.File | undefined, me: AuthenticatedUser): Promise<TaskFileDto> {
    await this.load(id);
    if (!file?.size) throw new BadRequestException('The file is empty.');
    if (eventId) {
      // Files on a comment belong to its author, added straight after it.
      const e = await this.prisma.taskEvent.findUnique({ where: { id: eventId } });
      if (!e || e.taskId !== id || e.kind !== 'comment' || e.userId !== me.id) throw new BadRequestException('Files can only be added to your own message.');
    }
    const path = `${FILES_SUBDIR}/${randomUUID()}`;
    writeFileSync(join(ensureUploadDir(FILES_SUBDIR), path.slice(FILES_SUBDIR.length + 1)), file.buffer);
    const f = await this.prisma.taskFile.create({
      data: {
        taskId: id,
        eventId,
        name: text(Buffer.from(file.originalname, 'latin1').toString('utf8'), 'File name', 255, true).replace(/[\\/]/g, '_'),
        mimeType: (file.mimetype || 'application/octet-stream').slice(0, 120),
        size: file.size,
        path,
        uploadedById: me.id,
      },
    });
    if (!eventId) await this.event(id, me.id, 'file_added', { name: f.name });
    await this.prisma.task.update({ where: { id }, data: { updatedAt: new Date() } });
    return fileDto(f);
  }

  async readFile(fileId: number): Promise<{ file: TaskFile; content: Buffer }> {
    const file = await this.prisma.taskFile.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found.');
    try {
      return { file, content: readFileSync(join(UPLOADS_DIR, file.path)) };
    } catch {
      throw new NotFoundException('File not found.');
    }
  }

  async removeFile(fileId: number, me: AuthenticatedUser): Promise<TaskDetailDto> {
    const f = await this.prisma.taskFile.findUnique({ where: { id: fileId } });
    if (!f) throw new NotFoundException('File not found.');
    if (f.eventId) throw new BadRequestException('A file sent with a message stays with the message.');
    const t = await this.load(f.taskId);
    if (!(me.permissions.includes('*') || f.uploadedById === me.id || t.reporterId === me.id)) throw new ForbiddenException('Only the person who added the file can remove it.');
    await this.prisma.taskFile.delete({ where: { id: fileId } });
    rmSync(join(UPLOADS_DIR, f.path), { force: true });
    await this.event(f.taskId, me.id, 'file_removed', { name: f.name });
    await this.prisma.task.update({ where: { id: f.taskId }, data: { updatedAt: new Date() } });
    return this.get(f.taskId);
  }
}
