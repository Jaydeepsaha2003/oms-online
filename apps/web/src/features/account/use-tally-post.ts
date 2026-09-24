import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TallyPostResult } from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { useConfirm } from '@/components/common/confirm';

/**
 * "Post to Tally" from anywhere (challan list, after saving a challan, credit notes). Always
 * asks first; the server runs every check (SSS series, party mapping, GST
 * lock, duplicates) and says plainly why when it refuses.
 */
export function usePostToTally(path = '/tally/post', listKey = 'challans') {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const m = useMutation({
    mutationFn: (code: string) => http.post<TallyPostResult>(path, { code }),
    onSuccess: (r) => {
      const say = r.status === 'POSTED' ? toast.success : r.status === 'FAILED' ? toast.error : toast.warning;
      say(r.message, { description: r.warnings.length ? `Check in Tally: ${r.warnings.join(' · ')}` : undefined, duration: 12_000 });
    },
    onError: (e) => toast.error(getApiErrorMessage(e), { duration: 12_000 }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [listKey] });
      qc.invalidateQueries({ queryKey: ['tally'] });
    },
  });

  const post = async (code: string, detail: string) => {
    const ok = await confirm({
      title: `Post ${code} to Tally?`,
      description: `${detail}. After posting, open it in Tally and check it — make the e-invoice only then.`,
      confirmText: 'Post to Tally',
    });
    if (ok) m.mutate(code);
  };
  return { post, pendingCode: m.isPending ? m.variables : null };
}
