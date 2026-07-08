import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NextNoteNoResult,
  NoteDirectoryList,
  NoteDirectoryQuery,
  NoteDto,
  NoteMode,
  RecentSoldRow,
  SaveNoteInput,
  SaveNoteResult,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['notes'] as const;

/** Next voucher number for the mode (DN/<n> or CN/<n>). */
export function useNextNoteNo(mode: NoteMode) {
  return useQuery({
    queryKey: [...KEY, 'next', mode],
    queryFn: () => http.get<NextNoteNoResult>('/notes/next', { params: { mode } }),
  });
}

/** The party's last 12 months of sold items — the product picker source. */
export function useRecentSold(customerId: number | undefined) {
  return useQuery({
    queryKey: [...KEY, 'recent-sold', customerId],
    queryFn: () => http.get<RecentSoldRow[]>('/notes/recent-sold', { params: { customerId } }),
    enabled: customerId != null && customerId > 0,
  });
}

/** Directory list for the mode + filters. */
export function useNoteDirectory(query: NoteDirectoryQuery) {
  return useQuery({
    queryKey: [...KEY, 'directory', query],
    queryFn: () => http.get<NoteDirectoryList>('/notes/directory', { params: query }),
  });
}

/** One note (header + items) for editing. */
export function fetchNote(mode: NoteMode, code: string): Promise<NoteDto> {
  return http.get<NoteDto>(`/notes/${mode}/${encodeURIComponent(code)}`);
}

export function useSaveNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveNoteInput) => http.post<SaveNoteResult>('/notes', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mode, code }: { mode: NoteMode; code: string }) =>
      http.delete(`/notes/${mode}/${encodeURIComponent(code)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
