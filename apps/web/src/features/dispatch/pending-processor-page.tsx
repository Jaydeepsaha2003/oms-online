import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { PendingProcessorInfoDto } from '@oms/shared';
import { api, downloadFile, getApiErrorMessage, http } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';

const KEY = ['pending-processor'] as const;

/** What the downloaded workbook holds — the V6.0 macro's sheets, in order. */
const SHEETS = [
  ['PenOrderData', 'Every pending line with the processor columns: shop / Virar sheet, short name, size + product, vendor.'],
  ['ExceptShopPenOrder', 'Pivot by customer, product, comment, design and order — the non-shop designs.'],
  ['ShopPenOrder', 'The same pivot for designs on the Shop keyword list.'],
  ['VirarOrderToVendor', 'Pivot by category, sub-category and size + product, filterable by vendor.'],
  ['ShopOrderToVendor', 'The same vendor pivot for shop designs.'],
] as const;

/**
 * Dispatch → Pending Order Processor. The "Pending Order Processor V6.0" macro
 * moved online: it reads the pending orders straight from the OMS instead of
 * the Access database, and downloads the same workbook with its pivots.
 */
export function PendingProcessorPage() {
  const { can } = usePermissions();
  const canLoad = can('dispatch:update');
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => http.get<PendingProcessorInfoDto>('/pending-processor') });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return (await api.post<PendingProcessorInfoDto>('/pending-processor/lookups', body)).data;
    },
    onSuccess: (info) => {
      qc.setQueryData(KEY, info);
      toast.success(`Loaded ${info.lookups?.shopKeywords.length} shop keywords, ${info.lookups?.shortNames} short names and ${info.lookups?.vendors} vendors`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not read the workbook')),
  });

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile('/pending-processor/export', 'pen_order_process.xlsx');
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not build the file'));
    } finally {
      setDownloading(false);
    }
  };

  const l = data?.lookups;
  const tiles = [
    { label: 'Pending lines', value: data?.pendingLines ?? '—', hint: 'In the file, as on Dispatch' },
    { label: 'Shop keywords', value: l?.shopKeywords.length ?? '—', hint: 'Design → ShopPenOrder' },
    { label: 'Short names', value: l?.shortNames ?? '—', hint: 'Customer → CUSTOMER column' },
    { label: 'Vendors', value: l?.vendors ?? '—', hint: 'Size + product → vendor' },
  ];

  return (
    <div className="pls-page flex flex-col gap-3.5">
      <div className="pls-backdrop" aria-hidden />

      <section className="pls-hero">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[12px] font-bold tracking-[0.04em] text-white/80">Dispatch · Pending Order Processor</span>
            <h1 className="mt-0.5 text-[26px] leading-tight font-extrabold tracking-[-0.02em]">Processed pending orders</h1>
            <p className="mt-1.5 text-[13px] text-white/80">
              The V6.0 processor workbook, built from the OMS: PenOrderData and its four pivots, with the same filters.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canLoad && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsm,.xlsx"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) upload.mutate(f);
                  }}
                />
                <button type="button" className="pls-hbtn" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                  {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {l ? 'Update lookups' : 'Load processor workbook'}
                </button>
              </>
            )}
            <button type="button" className="pls-hbtn" onClick={() => void download()} disabled={downloading || !l || !data?.pendingLines}>
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Download Excel
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="pls-htile">
              <div className="pls-htile-label">{t.label}</div>
              <div className="mt-0.5 text-[22px] font-extrabold tabular-nums">{isLoading ? '—' : t.value}</div>
              <div className="truncate text-[11.5px] text-white/75">{t.hint}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="pls-sec p-4">
        <div className="pls-label">Lookups</div>
        {l ? (
          <>
            <p className="mt-1 text-[13px]">
              From <b>{l.fileName}</b> · loaded {formatDate(l.loadedAt)}
              {l.loadedBy ? ` by ${l.loadedBy}` : ''}. Its Settings and Vendor Details sheets; change them in Excel and load the workbook again.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {l.shopKeywords.map((k) => (
                <span key={k} className="pls-cond">
                  {k}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-1 text-[13px]">
            {canLoad
              ? 'Load your "Pending Order Processor" workbook (.xlsm) once — its Settings sheet (shop keywords, short customer names) and Vendor Details sheet are kept here.'
              : 'Not loaded yet — ask someone with dispatch edit rights to load the Pending Order Processor workbook.'}
          </p>
        )}
      </section>

      <section className="pls-sec p-4">
        <div className="pls-label">In the download</div>
        <ul className="mt-2 flex flex-col gap-2">
          {SHEETS.map(([name, what]) => (
            <li key={name} className="flex items-start gap-2.5 text-[13px]">
              <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span>
                <b>{name}</b> — {what}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default PendingProcessorPage;
