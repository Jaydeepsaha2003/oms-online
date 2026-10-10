import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTaskInput, TaskDetailDto, TaskFileDto, TaskListDto, UpdateTaskInput } from '@oms/shared';
import { api, http } from '@/lib/api';

const KEY = ['tasks'] as const;
/** A reply from the other side shows up without a reload. */
const REFRESH_MS = 30_000;

export const useTaskList = () => useQuery({ queryKey: KEY, queryFn: () => http.get<TaskListDto>('/tasks'), refetchInterval: REFRESH_MS });

export const useTask = (id: number | null) =>
  useQuery({ queryKey: [...KEY, id], queryFn: () => http.get<TaskDetailDto>(`/tasks/${id}`), enabled: id != null, refetchInterval: REFRESH_MS });

/** Every write answers with the task's new detail: store it, refresh the list. */
function useTaskWrite<V>(fn: (v: V) => Promise<TaskDetailDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      qc.setQueryData([...KEY, d.id], d);
      void qc.invalidateQueries({ queryKey: KEY, exact: true });
    },
  });
}

export const uploadTaskFile = (id: number, file: File, eventId?: number) => {
  const body = new FormData();
  body.append('file', file);
  return http.post<TaskFileDto>(`/tasks/${id}/files${eventId ? `?eventId=${eventId}` : ''}`, body, { timeout: 0 });
};

export const useCreateTask = () =>
  useTaskWrite(async ({ input, files }: { input: CreateTaskInput; files: File[] }) => {
    const t = await http.post<TaskDetailDto>('/tasks', input);
    if (!files.length) return t;
    await Promise.allSettled(files.map((f) => uploadTaskFile(t.id, f)));
    return http.get<TaskDetailDto>(`/tasks/${t.id}`);
  });

export const useUpdateTask = () => useTaskWrite(({ id, input }: { id: number; input: UpdateTaskInput }) => http.patch<TaskDetailDto>(`/tasks/${id}`, input));
export const useCompleteTask = () =>
  useTaskWrite(({ id, resolution, notify }: { id: number; resolution: string; notify: boolean }) => http.post<TaskDetailDto>(`/tasks/${id}/complete`, { resolution, notify }));
export const useReopenTask = () => useTaskWrite((id: number) => http.post<TaskDetailDto>(`/tasks/${id}/reopen`));
export const useRemoveTaskFile = () => useTaskWrite((fileId: number) => http.delete<TaskDetailDto>(`/tasks/files/${fileId}`));

export const useAddTaskFiles = () =>
  useTaskWrite(async ({ id, files }: { id: number; files: File[] }) => {
    for (const f of files) await uploadTaskFile(id, f);
    return http.get<TaskDetailDto>(`/tasks/${id}`);
  });

/** A message, then its files; resolves with how many files failed. */
export const useSendComment = () =>
  useTaskWrite(async ({ id, text, files }: { id: number; text: string; files: File[] }) => {
    const { eventId } = await http.post<{ eventId: number }>(`/tasks/${id}/comments`, { text, withFiles: files.length > 0 });
    await Promise.allSettled(files.map((f) => uploadTaskFile(id, f, eventId)));
    return http.get<TaskDetailDto>(`/tasks/${id}`);
  });

export const downloadTaskFile = (fileId: number) => api.get<Blob>(`/tasks/files/${fileId}`, { responseType: 'blob', timeout: 0 }).then((r) => r.data);
