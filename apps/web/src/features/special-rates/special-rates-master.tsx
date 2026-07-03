import { useEffect, useMemo, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { SpecialRateMasterRow } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCustomers } from '@/features/customers/use-customers';
import { useAllSpecialRates, useDeleteCustomerLogo, useDeleteCustomerRate, useSpecialRateAgents, useSpecialRateLookups } from './use-special-rates';

const PAGE_SIZE = 50;
const TYPE_OPTS = [
  { value: 'PRODUCT', label: 'Product rate' },
  { value: 'DESIGN', label: 'Design rate' },
  { value: 'LOGO', label: 'Logo' },
];
const LEVEL_OPTS = [
  { value: 'CATEGORY', label: 'Whole category' },
  { value: 'SUBCATEGORY', label: 'Sub-category' },
  { value: 'ITEM', label: 'Specific item' },
];
const typeLabel = (v: string) => TYPE_OPTS.find((t) => t.value === v)?.label ?? v;
const levelLabel = (v: string) => LEVEL_OPTS.find((l) => l.value === v)?.label ?? v;
const signed = (n: number) => (n > 0 ? `+${n.toLocaleString('en-IN')}` : n.toLocaleString('en-IN'));

const TYPE_BADGE: Record<string, string> = {
  PRODUCT: 'bg-sky-100 text-sky-700 ring-sky-200',
  DESIGN: 'bg-violet-100 text-violet-700 ring-violet-200',
  LOGO: 'bg-rose-100 text-rose-700 ring-rose-200',
};

/** Maps a value/label option set onto the string-only NativeSelect. */
function MapSelect({ value, onChange, opts, placeholder }: { value: string; onChange: (v: string) => void; opts: { value: string; label: string }[]; placeholder: string }) {
  const labels = opts.map((o) => o.label);
  const cur = opts.find((o) => o.value === value)?.label ?? '';
  return (
    <NativeSelect
      value={cur}
      onChange={(label) => onChange(opts.find((o) => o.label === label)?.value ?? '')}
      options={['', ...labels]}
      placeholder={placeholder}
    />
  );
}

export function SpecialRatesMaster() {
  const { can } = usePermissions();
  const canDelete = can('specialrate:delete');
  const confirm = useConfirm();
  const delRate = useDeleteCustomerRate();
  const delLogo = useDeleteCustomerLogo();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [agent, setAgent] = useState('');
  const [type, setType] = useState('');
  const [scope, setScope] = useState('');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: customerData } = useCustomers({ page: 1, pageSize: 1000 });
  const { data: agents } = useSpecialRateAgents();
  const { data: lookups } = useSpecialRateLookups();

  const customerNames = useMemo(() => (customerData?.items ?? []).map((c) => c.partyName).filter(Boolean) as string[], [customerData]);
  const subOptions = useMemo(
    () => [...new Set((lookups?.subCategories ?? []).filter((sc) => !category || sc.category === category).map((sc) => sc.subCategory))].sort(),
    [lookups, category],
  );

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined, customer: customer || undefined, agent: agent || undefined, type: type || undefined, scope: scope || undefined, category: category || undefined, subCategory: subCategory || undefined };
  const { data, isLoading } = useAllSpecialRates(query);
  const rows = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const setFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const anyFilter = !!(search || customer || agent || type || scope || category || subCategory);
  const clearAll = () => {
    setSearchInput('');
    setSearch('');
    setCustomer('');
    setAgent('');
    setType('');
    setScope('');
    setCategory('');
    setSubCategory('');
    setPage(1);
  };

  const onDelete = async (r: SpecialRateMasterRow) => {
    const what = r.type === 'LOGO' ? 'logo restriction' : 'rate override';
    const ok = await confirm({
      title: `Remove ${what}?`,
      description: `${r.customerName} · ${levelLabel(r.scope)} · ${r.category}${r.subCategory ? ` / ${r.subCategory}` : ''}${r.target ? ` / ${r.target}` : ''}`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const mut = r.source === 'LOGO' ? delLogo : delRate;
    mut.mutate(r.id, {
      onSuccess: () => toast.success('Removed'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const columns: DataColumn<SpecialRateMasterRow>[] = [
    { id: 'customer', label: 'Customer', pin: 'left0', fixed: true, cell: (r) => <span className="font-medium">{r.customerName}</span> },
    { id: 'agent', label: 'Agent', cell: (r) => r.agentName || '—' },
    {
      id: 'type',
      label: 'Type',
      cell: (r) => <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TYPE_BADGE[r.type] ?? 'bg-muted')}>{typeLabel(r.type)}</span>,
    },
    { id: 'level', label: 'Level', cell: (r) => levelLabel(r.scope) },
    { id: 'category', label: 'Category', cell: (r) => r.category },
    { id: 'sub', label: 'Sub-cat', cell: (r) => r.subCategory || '—' },
    { id: 'item', label: 'Item', cell: (r) => r.target || '—' },
    {
      id: 'value',
      label: 'Value',
      align: 'right',
      cell: (r) =>
        r.type === 'LOGO' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
            <Ban className="size-3" /> Not allowed
          </span>
        ) : (
          <span className={cn('font-semibold tabular-nums', (r.rate ?? 0) > 0 ? 'text-emerald-600' : (r.rate ?? 0) < 0 ? 'text-rose-600' : '')}>{signed(r.rate ?? 0)}</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="bg-card space-y-3 rounded-xl border p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative w-full sm:w-64">
            <Label className="text-xs">Search</Label>
            <Search className="text-muted-foreground pointer-events-none absolute top-[30px] left-3 size-4" />
            <Input className="pl-9" placeholder="Customer, category, item…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <div className="w-48 space-y-1">
            <Label className="text-xs">Customer</Label>
            <NativeSelect value={customer} onChange={(v) => setFilter(() => setCustomer(v))} options={['', ...customerNames]} placeholder="All customers" />
          </div>
          <div className="w-40 space-y-1">
            <Label className="text-xs">Agent</Label>
            <NativeSelect value={agent} onChange={(v) => setFilter(() => setAgent(v))} options={['', ...(agents ?? [])]} placeholder="All agents" />
          </div>
          <div className="w-40 space-y-1">
            <Label className="text-xs">Type</Label>
            <MapSelect value={type} onChange={(v) => setFilter(() => setType(v))} opts={TYPE_OPTS} placeholder="All types" />
          </div>
          <div className="w-44 space-y-1">
            <Label className="text-xs">Level</Label>
            <MapSelect value={scope} onChange={(v) => setFilter(() => setScope(v))} opts={LEVEL_OPTS} placeholder="All levels" />
          </div>
          <div className="w-40 space-y-1">
            <Label className="text-xs">Category</Label>
            <NativeSelect value={category} onChange={(v) => setFilter(() => { setCategory(v); setSubCategory(''); })} options={['', ...(lookups?.categories ?? [])]} placeholder="All categories" />
          </div>
          <div className="w-44 space-y-1">
            <Label className="text-xs">Sub-category</Label>
            <NativeSelect value={subCategory} onChange={(v) => setFilter(() => setSubCategory(v))} options={['', ...subOptions]} placeholder="All sub-cats" />
          </div>
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground">
              <X /> Clear
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">{data?.total ?? 0} matching record(s) across all customers.</p>
      </div>

      <DataTable columns={columns} rows={rows} rowKey={(r) => r.rowKey} isLoading={isLoading} dense emptyText="No special rates match these filters." actions={canDelete ? (r) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => onDelete(r)} aria-label="Remove" title="Remove">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ) : undefined} />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Page {data?.page ?? page} of {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
