import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListPlus, Loader2, Search, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAdditions, useRemoveFromList } from './use-account-groups';

const drcr = (v: number | null) =>
  v == null ? null : Math.abs(v) < 1 ? 'nil' : `₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${v < 0 ? 'Cr' : 'Dr'}`;

export function AdditionListDialog({ onClose, canAdd }: { onClose: () => void; canAdd: boolean }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: items = [], isLoading } = useAdditions();
  const remove = useRemoveFromList();
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const rows = items.filter((a) => !q || a.tallyName.toLowerCase().includes(q) || a.groupName.toLowerCase().includes(q));

  const onRemove = async (id: number, name: string) => {
    const ok = await confirm({ title: 'Remove from list?', description: `"${name}" will be taken off the addition list. Nothing else changes.`, confirmText: 'Remove' });
    if (!ok) return;
    remove.mutate(id, { onError: (e) => toast.error(getApiErrorMessage(e, 'Could not remove')) });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:h-[80vh] sm:max-w-2xl">
        <div className="shrink-0 border-b px-4 pt-4 pb-3 sm:px-5">
          <DialogTitle className="flex items-center gap-2 pr-10 text-[16px]">
            <ListPlus className="size-4 text-indigo-600" /> Addition list
          </DialogTitle>
          <DialogDescription className="pr-10 text-[12px]">
            Tally parties waiting to be added to OMS. Press Add to open the New Customer form, filled in from Tally.
          </DialogDescription>
          <div className="relative mt-2.5 w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input placeholder="Search…" className="h-8 pl-8 text-[12.5px]" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5">
          {isLoading && (
            <div className="text-muted-foreground grid place-items-center py-10">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {!isLoading && !rows.length && (
            <p className="text-muted-foreground py-10 text-center text-[12.5px]">
              {items.length ? 'Nothing matches.' : 'The list is empty. Add parties from Customers → Tally master → Not in OMS.'}
            </p>
          )}
          {rows.map((a) => {
            const info = [a.details.creditPeriod ? `${a.details.creditPeriod} days` : null, a.details.city, a.details.state, a.details.mobile].filter(Boolean).join(' · ');
            return (
              <div key={a.id} className="bg-card flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-slate-900 dark:text-slate-100" title={a.tallyName}>{a.tallyName}</p>
                  <p className="text-muted-foreground truncate text-[11px] font-medium">
                    Under {a.groupName}
                    {info && ` · ${info}`}
                  </p>
                  <p className="text-[11.5px] font-medium text-slate-600 dark:text-slate-300">
                    Tally closing{' '}
                    <b className={cn('tabular-nums', Math.abs(a.tallyClosing ?? 0) < 1 ? 'text-muted-foreground' : (a.tallyClosing ?? 0) < 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
                      {drcr(a.tallyClosing) ?? '—'}
                    </b>
                    {a.balanceTo && a.tallyClosing != null && <span className="text-muted-foreground"> as at {formatDate(a.balanceTo)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive size-8"
                    onClick={() => void onRemove(a.id, a.tallyName)}
                    aria-label="Remove from list"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  {canAdd && (
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 rounded-[4px] text-[12px] font-bold"
                      onClick={() => {
                        onClose();
                        navigate(`/customers/new?addition=${a.id}`);
                      }}
                    >
                      <UserPlus className="size-3.5" /> Add
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
