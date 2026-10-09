import { CheckCircle2, ReceiptText, X } from 'lucide-react';
import { toast } from 'sonner';

/** One bill the Tally PC has finished (see BillReadyService on the server). */
interface BillRow {
  billNo: string;
  party: string;
  amount: number | null;
  eway: string | null;
}

const ID = 'bill-ready';
/** Shown for 5 s after the LAST bill arrives — each new one restarts the clock. */
const SHOW_MS = 5000;
let rows: BillRow[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * "Bill ready — please collect", WhatsApp-style: one card, each finished bill
 * on its own line under the last, with a green tick. Information only.
 */
export function showBillReady(data: Record<string, unknown>): void {
  const row: BillRow = {
    billNo: String(data.billNo ?? ''),
    party: String(data.party ?? ''),
    amount: typeof data.amount === 'number' ? data.amount : null,
    eway: typeof data.eway === 'string' ? data.eway : null,
  };
  if (!rows.some((r) => r.billNo === row.billNo)) rows = [...rows, row];
  toast.custom((t) => <BillReadyCard rows={rows} onClose={() => toast.dismiss(t)} />, {
    id: ID,
    duration: Infinity,
    onDismiss: () => {
      rows = [];
    },
  });
  clearTimeout(timer);
  timer = setTimeout(() => toast.dismiss(ID), SHOW_MS);
}

function BillReadyCard({ rows, onClose }: { rows: BillRow[]; onClose: () => void }) {
  return (
    <div className="bg-card w-[min(360px,calc(100vw-2rem))] rounded-2xl border p-3 shadow-2xl">
      <div className="mb-2 flex items-center gap-2 border-b pb-1.5">
        <ReceiptText className="size-4 text-emerald-600" />
        <span className="flex-1 text-[12px] font-bold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
          Bill ready — please collect
        </span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground rounded p-0.5" aria-label="Close">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.billNo} className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{r.party}</p>
              <p className="text-muted-foreground text-xs">
                {[r.billNo, r.amount ? `₹${Math.round(r.amount).toLocaleString('en-IN')}` : '', r.eway ? 'e-way ✓' : ''].filter(Boolean).join(' · ')}
                {' · '}
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">bill ban gaya</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
