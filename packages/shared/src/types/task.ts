/** Tasks & Bugs — shared by OMS and WMS. */
export type TaskApp = 'OMS' | 'WMS';
export type TaskType = 'bug' | 'task';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'open' | 'in_progress' | 'in_review' | 'done';

export const TASK_PRIORITIES: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
export const TASK_STATUSES: TaskStatus[] = ['open', 'in_progress', 'in_review', 'done'];

export interface TaskPersonDto {
  id: string;
  name: string;
  /** Holds `task:approve` — may mark a task complete. */
  isDeveloper: boolean;
}

export interface TaskSummaryDto {
  id: number;
  /** BUG-12 / TSK-12 */
  key: string;
  app: TaskApp;
  type: TaskType;
  title: string;
  area: string;
  priority: TaskPriority;
  status: TaskStatus;
  reporterId: string;
  assigneeIds: string[];
  messageCount: number;
  fileCount: number;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFileDto {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  uploadedById: string;
  createdAt: string;
}

export interface TaskEventDto {
  id: number;
  userId: string | null;
  kind: string;
  text: string;
  data: Record<string, unknown>;
  files: TaskFileDto[];
  createdAt: string;
}

export interface TaskDetailDto extends TaskSummaryDto {
  description: string;
  steps: string[];
  doneById: string | null;
  resolution: string | null;
  files: TaskFileDto[];
  events: TaskEventDto[];
}

export interface TaskListDto {
  tasks: TaskSummaryDto[];
  people: TaskPersonDto[];
  me: { id: string; isDeveloper: boolean };
}

export interface CreateTaskInput {
  app: TaskApp;
  type: TaskType;
  title: string;
  description?: string;
  steps?: string[];
  area: string;
  priority?: TaskPriority;
  assigneeIds?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  area?: string;
  priority?: TaskPriority;
  status?: Exclude<TaskStatus, 'done'>;
  assigneeIds?: string[];
}
