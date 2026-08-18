import { ExternalLink, Loader2 } from 'lucide-react';
import type { ChallanDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { getApiErrorMessage } from '@/lib/api';
import { openPdf } from '@/lib/pdf';
import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useChallanByCode } from './use-challans';

/**
 * Read-only look at one saved challan, opened from screens that only hold a Ref
 * Inv number — the Credit/Debit Note item bar and its lines. Everything here is
 * a view; nothing edits, so it needs no draft or lock.
 */

const money = (v: number | null | undefined) => `₹ ${(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (v: number | null | undefined) => `₹ ${(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const qty = (v: number | null | undefined) => (v ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—');

const TH = 'bg-slate-800 px-2 py-1.5 text-left text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap dark:bg-slate-900';
const TD = 'border-b px-2 py-1 text-[13px] font-semibold text-slate-800 align-middle dark:text-slate-200';
const NUM = 'text-right tabular-nums';

/** One `label / value` line in the header strip. */
const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <div className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">{label}</div>
    <div className="truncate text-[13px] font-semibold">{value || '—'}</div>
  </div>
);

/** One totals row. */
const Total = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className={cn('flex items-center justify-between gap-4 py-0.5', strong && 'border-t pt-1.5 text-[15px] font-extrabold')}>
    <span className={cn('text-[11px] font-bold tracking-wide uppercase', strong ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

export function ChallanPreviewDialog({
  code,
  onClose,
}: {
  /** Invoice number to show. null keeps the dialog closed. */
  code: string | null;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const { data: challan, isLoading, error } = useChallanByCode(code);

  return (
    <Dialog open={Boolean(code)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{code}</span>
            {challan && <span className="text-muted-foreground text-[13px] font-normal">{formatDate(challan.invDate)}</span>}
          </DialogTitle>
          <DialogDescription>The sale this note line refers to. View only.</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading challan…
          </div>
        )}
        {error && <div className="text-destructive py-10 text-sm font-semibold">{getApiErrorMessage(error, 'Could not load this challan.')}</div>}

        {challan && <PreviewBody challan={challan} canPrint={can('challan:print')} />}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ challan, canPrint }: { challan: ChallanDto; canPrint: boolean }) {
  const taxable = challan.items.reduce((a, it) => a + (it.amount ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 rounded-md border p-2.5 sm:grid-cols-4">
        <Fact label="Party" value={challan.customerName} />
        <Fact label="Transport" value={challan.transName ?? ''} />
        <Fact label="Category" value={challan.category ?? ''} />
        <Fact label="Status" value={challan.challanStatus} />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse">
          <caption className="sr-only">Lines on challan {challan.code}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(TH, 'w-9 text-center')}>#</th>
              <th scope="col" className={TH}>Product</th>
              <th scope="col" className={cn(TH, 'w-24')}>Design</th>
              <th scope="col" className={cn(TH, NUM, 'w-16')}>Bags</th>
              <th scope="col" className={cn(TH, NUM, 'w-16')}>Pcs</th>
              <th scope="col" className={cn(TH, NUM, 'w-16')}>Kgs</th>
              <th scope="col" className={cn(TH, NUM, 'w-16')}>Box</th>
              <th scope="col" className={cn(TH, NUM, 'w-24')}>Price</th>
              <th scope="col" className={cn(TH, NUM, 'w-28')}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {challan.items.map((it, i) => (
              <tr key={it.id} className="odd:bg-muted/30">
                <td className={cn(TD, 'text-center')}>{i + 1}</td>
                <td className={TD}>{it.productName ?? '—'}</td>
                <td className={TD}>{it.design ?? '—'}</td>
                <td className={cn(TD, NUM)}>{qty(it.bags)}</td>
                <td className={cn(TD, NUM)}>{qty(it.pcs)}</td>
                <td className={cn(TD, NUM)}>{qty(it.kgs)}</td>
                <td className={cn(TD, NUM)}>{qty(it.box)}</td>
                <td className={cn(TD, NUM)}>{qty(it.price)}</td>
                <td className={cn(TD, NUM, 'font-bold')}>{money(it.amount)}</td>
              </tr>
            ))}
            {!challan.items.length && (
              <tr>
                <td colSpan={9} className={cn(TD, 'text-muted-foreground text-center')}>This challan has no lines.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:order-2 sm:w-72">
          <Total label="Taxable" value={money(taxable)} />
          {Boolean(challan.freight) && <Total label="Freight" value={money(challan.freight)} />}
          {Boolean(challan.packing) && <Total label="Packing" value={money(challan.packing)} />}
          {Boolean(challan.pouch) && <Total label="Box / Pouch" value={money(challan.pouch)} />}
          <Total label={`GST${challan.gst ? ` @ ${challan.gst}%` : ''}`} value={money(challan.tax)} />
          <Total label="Total" value={money0(challan.total)} strong />
        </div>
        {canPrint && (
          <Button
            type="button"
            variant="outline"
            className="sm:order-1"
            onClick={() => openPdf(`/challans/${challan.id}/challan.pdf`, `${challan.code.replace(/[\\/:*?"<>|]/g, '-')}.pdf`)}
          >
            <ExternalLink className="size-4" /> Open PDF
          </Button>
        )}
      </div>
    </div>
  );
}
