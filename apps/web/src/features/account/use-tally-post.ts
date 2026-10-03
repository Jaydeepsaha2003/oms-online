import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TallyPostResult } from '@oms/shared';
import { getApiErrorMessage, getEwayNotice, http } from '@/lib/api';
import { useConfirm } from '@/components/common/confirm';

/** A sleeping Tally PC is woken before the bill is posted (up to 90 s), so this call may take longer than the usual 15 s. */
export const POST_WAIT_MS = 120_000;

/**
 * Post one bill. A party (or transporter) that needs an e-way bill on every bill makes the server answer 409 EWAY_NOTICE first,
 * before anything is sent: `ask` shows it, and the bill is posted again with the answer. Null = the person said no.
 */
export async function postBill(path: string, code: string, ask: (message: string) => Promise<boolean>): Promise<TallyPostResult | null> {
  try {
    return await http.post<TallyPostResult>(path, { code }, { timeout: POST_WAIT_MS });
  } catch (e) {
    const notice = getEwayNotice(e);
    if (!notice) throw e;
    if (!(await ask(notice))) return null;
    return http.post<TallyPostResult>(path, { code, ewayAck: true }, { timeout: POST_WAIT_MS });
  }
}

/**
 * "Post to Tally" from anywhere (challan list, after saving a challan, credit notes). Always
 * asks first; the server runs every check (SSS series, party mapping, GST
 * lock, duplicates) and says plainly why when it refuses.
 */
export function usePostToTally(path = '/tally/post', listKey = 'challans') {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const m = useMutation({
    mutationFn: (code: string) => postBill(path, code, (message) => confirm({ title: 'E-way bill needed', description: message, confirmText: 'Post it' })),
    onSuccess: (r) => {
      if (!r) return; // said no to the e-way notice
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
      description: `${detail}. The Tally PC then makes the e-invoice, e-way bill and print by itself (tally-pc on the Tally PC).`,
      confirmText: 'Post to Tally',
    });
    if (ok) m.mutate(code);
  };
  return { post, pendingCode: m.isPending ? m.variables : null };
}
