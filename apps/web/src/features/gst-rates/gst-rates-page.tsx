import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
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
  exportGstRates,
  useBulkGstRates,
  useDeleteGstRate,
  useGstLookups,
  useGstRatesByCustomer,
  useImportGstRates,
} from './use-gst-rates';

interface Line {
  key: string;
  id?: number;
  category: string;
  rate: string;
}

export function GstRatesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { data: lookups } = useGstLookups();
  const [customer, setCustomer] = useState('');
  const { data: existing, isFetching } = useGstRatesByCustomer(customer);
  const bulk = useBulkGstRates();
  const del = useDeleteGstRate();
  const importMut = useImportGstRates();
  const keyer = useRef(0);

  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!customer.trim()) {
      setLines([]);
      return;
    }
    if (existing) {
      setLines(
        existing.map((r) => ({ key: `e${r.id}`, id: r.id, category: r.category, rate: r.rate?.toString() ?? '' })),
      );
    }
  }, [existing, customer]);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addLine = () => setLines((ls) => [...ls, { key: `n${keyer.current++}`, category: '', rate: '' }]);

  const removeLine = async (line: Line) => {
    if (line.id) {
      const ok = await confirm({
        title: 'Remove GST rate?',
        description: `Remove the saved rate for "${line.category}"?`,
        confirmText: 'Remove',
        destructive: true,
      });
      if (!ok) return;
      del.mutate(line.id, {
        onSuccess: () => {
          setLines((ls) => ls.filter((l) => l.key !== line.key));
          toast.success('Rate removed');
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
      });
    } else {
      setLines((ls) => ls.filter((l) => l.key !== line.key));
    }
  };

  const save = () => {
    if (!customer.trim()) return toast.error('Select a customer first');
    const rates = lines
      .filter((l) => l.category.trim() !== '')
      .map((l) => ({ category: l.category.trim(), rate: l.rate.trim() === '' ? null : Number(l.rate) }));
    if (rates.length === 0) return toast.error('Add at least one category rate');
    bulk.mutate(
      { customerName: customer.trim(), rates },
      {
        onSuccess: (res) => toast.success(`Saved ${res.saved} rate(s)`),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Customer GST Rates</h2>
          <p className="text-muted-foreground text-sm">Set GST rate per product category for a customer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('gstrate:export') && <ExportButton onClick={() => exportGstRates()} />}
          {can('gstrate:import') && (
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
              Choose a customer to view and edit their GST rates.
            </p>
          ) : (
            <>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product category</TableHead>
                      <TableHead className="w-40">Rate (%)</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isFetching && lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                          <Loader2 className="mx-auto size-5 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                          No rates yet — add a row.
                        </TableCell>
                      </TableRow>
                    ) : (
                      lines.map((line) => (
                        <TableRow key={line.key}>
                          <TableCell>
                            <Combo
                              value={line.category}
                              onChange={(v) => setLine(line.key, { category: v })}
                              options={lookups?.categories ?? []}
                              disabled={!!line.id}
                              placeholder="Category"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="text-right tabular-nums"
                              value={line.rate}
                              onChange={(e) => setLine(line.key, { rate: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                              onClick={() => removeLine(line)}
                              aria-label="Remove"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addLine}>
                  <Plus /> Add category
                </Button>
                {can('gstrate:update') && (
                  <Button onClick={save} disabled={bulk.isPending}>
                    {bulk.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save rates
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
