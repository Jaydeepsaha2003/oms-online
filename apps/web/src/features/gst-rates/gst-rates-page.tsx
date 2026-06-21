import { useEffect, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
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

/** One editable grid row: every product category for the chosen customer. */
interface Line {
  key: string;
  /** Present only when a rate already exists (allows per-row delete). */
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

  const [lines, setLines] = useState<Line[]>([]);

  // Selecting a customer builds a fillable row for EVERY product category, with the
  // rate pre-filled wherever one already exists.
  useEffect(() => {
    if (!customer.trim()) {
      setLines([]);
      return;
    }
    const byCat = new Map((existing ?? []).map((r) => [r.category.toUpperCase(), r]));
    const seen = new Set<string>();
    const rows: Line[] = [];
    for (const cat of lookups?.categories ?? []) {
      const ex = byCat.get(cat.toUpperCase());
      seen.add(cat.toUpperCase());
      rows.push({ key: ex ? `e${ex.id}` : `c-${cat}`, id: ex?.id, category: cat, rate: ex?.rate?.toString() ?? '' });
    }
    // Any saved categories that aren't in the master product list still show up.
    for (const r of existing ?? []) {
      if (!seen.has(r.category.toUpperCase())) {
        rows.push({ key: `e${r.id}`, id: r.id, category: r.category, rate: r.rate?.toString() ?? '' });
      }
    }
    setLines(rows);
  }, [existing, customer, lookups]);

  const setRate = (key: string, rate: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, rate } : l)));

  const removeLine = async (line: Line) => {
    if (!line.id) return;
    const ok = await confirm({
      title: 'Remove GST rate?',
      description: `Clear the saved rate for "${line.category}"?`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(line.id, {
      onSuccess: () => toast.success('Rate removed'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const save = () => {
    if (!customer.trim()) return toast.error('Select a customer first');
    const rates = lines
      .filter((l) => l.rate.trim() !== '')
      .map((l) => ({ category: l.category.trim(), rate: Number(l.rate) }));
    if (rates.length === 0) return toast.error('Enter at least one rate');
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

  const priced = lines.filter((l) => l.rate.trim() !== '').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Customer GST Rates</h2>
          <p className="text-muted-foreground text-sm">
            Pick a customer, fill the GST rate for each product category, then save.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('gstrate:export') && <ExportButton onClick={() => exportGstRates()} />}
          {can('gstrate:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
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
            <p className="text-muted-foreground py-10 text-center text-sm">
              Choose a customer to view and fill their GST rates by category.
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border">
                <Table className="[&_tbody_td]:bg-card [&_tbody_tr:nth-child(even)_td]:bg-slate-50">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product category</TableHead>
                      <TableHead className="w-44">Rate (%)</TableHead>
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
                          No product categories found — add products first.
                        </TableCell>
                      </TableRow>
                    ) : (
                      lines.map((line) => (
                        <TableRow key={line.key}>
                          <TableCell className="font-medium">{line.category}</TableCell>
                          <TableCell>
                            <div className="relative">
                              <Input
                                type="number"
                                step="any"
                                inputMode="decimal"
                                placeholder="—"
                                className="pr-7 text-right tabular-nums"
                                value={line.rate}
                                onChange={(e) => setRate(line.key, e.target.value)}
                              />
                              <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
                                %
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {line.id && can('gstrate:delete') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-destructive hover:text-destructive"
                                onClick={() => removeLine(line)}
                                aria-label="Remove"
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

              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">
                  <span className="text-foreground font-medium tabular-nums">{priced}</span> of {lines.length}{' '}
                  categories priced
                </p>
                {can('gstrate:update') && (
                  <Button onClick={save} disabled={bulk.isPending}>
                    {bulk.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save all
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
