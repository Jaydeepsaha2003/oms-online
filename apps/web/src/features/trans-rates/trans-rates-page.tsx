import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Combo } from '@/components/common/combo';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  exportTransRates,
  useDeleteTransRate,
  useImportTransRates,
  useTransLookups,
  useTransRatesByCustomer,
  useUpsertTransRate,
} from './use-trans-rates';

export function TransRatesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { data: lookups } = useTransLookups();
  const [customer, setCustomer] = useState('');
  const { data: rates, isFetching } = useTransRatesByCustomer(customer);
  const upsert = useUpsertTransRate();
  const del = useDeleteTransRate();
  const importMut = useImportTransRates();

  // New-rate row
  const [transportName, setTransportName] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [rate, setRate] = useState('');

  const add = () => {
    if (!customer.trim()) return toast.error('Select a customer first');
    if (!category.trim() || !type.trim()) return toast.error('Category and Type are required');
    upsert.mutate(
      {
        customerName: customer.trim(),
        category: category.trim(),
        type: type.trim(),
        transportName: transportName.trim() || null,
        rate: rate.trim() === '' ? null : Number(rate),
      },
      {
        onSuccess: () => {
          toast.success('Rate saved');
          setRate('');
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );
  };

  const remove = async (id: number) => {
    const ok = await confirm({
      title: 'Delete transport rate?',
      description: 'This rate will be permanently removed.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(id, {
      onSuccess: () => toast.success('Rate deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const handleImport = async (file: File) => {
    try {
      const rows = await parseExcelFile(file);
      const res = await importMut.mutateAsync(rows);
      const skipped = res.errors.length ? `, ${res.errors.length} skipped` : '';
      toast.success(`Imported: ${res.created} created, ${res.updated} updated${skipped}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Import failed'));
    }
  };

  const items = rates ?? [];
  const transporterNames = (lookups?.transporters ?? []).map((t) => t.name);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Customer Transport Rates</h2>
          <p className="text-muted-foreground text-sm">
            Rates per customer × category × type × transporter.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('transrate:export') && <ExportButton onClick={() => exportTransRates()} />}
          {can('transrate:import') && (
            <ImportButton onFile={handleImport} pending={importMut.isPending} />
          )}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-2 sm:max-w-sm">
            <Label>Customer</Label>
            <Combo
              value={customer}
              onChange={setCustomer}
              options={lookups?.customers ?? []}
              placeholder="Select a customer…"
            />
          </div>

          {customer.trim() === '' ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Choose a customer to manage their transport rates.
            </p>
          ) : (
            <>
              {/* Add-rate row */}
              {can('transrate:create') && (
                <div className="grid grid-cols-2 items-end gap-2 rounded-lg border bg-muted/30 p-3 lg:grid-cols-5">
                  <div className="space-y-1">
                    <Label className="text-xs">Transporter</Label>
                    <Combo value={transportName} onChange={setTransportName} options={transporterNames} placeholder="Transporter" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Combo value={category} onChange={setCategory} options={lookups?.categories ?? []} placeholder="Category" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Combo value={type} onChange={setType} options={lookups?.types ?? []} placeholder="Type" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rate</Label>
                    <Input
                      type="number"
                      className="text-right tabular-nums"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                    />
                  </div>
                  <Button onClick={add} disabled={upsert.isPending} className="w-full">
                    {upsert.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add / Update
                  </Button>
                </div>
              )}

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transporter</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isFetching && items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                          <Loader2 className="mx-auto size-5 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                          No transport rates for this customer yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.transportName ?? '—'}</TableCell>
                          <TableCell>{r.category}</TableCell>
                          <TableCell>{r.type}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.rate ?? '—'}</TableCell>
                          <TableCell>
                            {can('transrate:delete') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-destructive hover:text-destructive"
                                onClick={() => remove(r.id)}
                                aria-label="Delete"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
