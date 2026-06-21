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
  exportTransRates,
  useBulkTransRates,
  useDeleteTransRate,
  useImportTransRates,
  useTransLookups,
  useTransRatesByCustomer,
} from './use-trans-rates';

/** One editable grid row = a category × type for the chosen customer. */
interface Line {
  key: string;
  /** Present only when the rate already exists (allows per-row delete). */
  id?: number;
  /** New rows let you pick the category/type; pre-listed rows show them read-only. */
  isNew?: boolean;
  category: string;
  type: string;
  transportName: string;
  rate: string;
}

export function TransRatesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { data: lookups } = useTransLookups();
  const [customer, setCustomer] = useState('');
  const { data: rates, isFetching } = useTransRatesByCustomer(customer);
  const bulk = useBulkTransRates();
  const del = useDeleteTransRate();
  const importMut = useImportTransRates();
  const keyer = useRef(0);

  const [lines, setLines] = useState<Line[]>([]);

  // Selecting a customer builds a fillable row for every category × type, with the
  // transporter + rate pre-filled wherever a rate already exists.
  useEffect(() => {
    if (!customer.trim()) {
      setLines([]);
      return;
    }
    const byKey = new Map((rates ?? []).map((r) => [`${r.category.toUpperCase()}|${r.type.toUpperCase()}`, r]));
    const seen = new Set<string>();
    const rows: Line[] = [];
    for (const cat of lookups?.categories ?? []) {
      for (const tp of lookups?.types ?? []) {
        const k = `${cat.toUpperCase()}|${tp.toUpperCase()}`;
        seen.add(k);
        const ex = byKey.get(k);
        rows.push({
          key: ex ? `e${ex.id}` : `c-${k}`,
          id: ex?.id,
          category: cat,
          type: tp,
          transportName: ex?.transportName ?? '',
          rate: ex?.rate?.toString() ?? '',
        });
      }
    }
    // Any saved rows whose category/type aren't in the master lists still show up.
    for (const r of rates ?? []) {
      const k = `${r.category.toUpperCase()}|${r.type.toUpperCase()}`;
      if (!seen.has(k)) {
        rows.push({
          key: `e${r.id}`,
          id: r.id,
          category: r.category,
          type: r.type,
          transportName: r.transportName ?? '',
          rate: r.rate?.toString() ?? '',
        });
      }
    }
    setLines(rows);
  }, [rates, customer, lookups]);

  const setField = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addRow = () =>
    setLines((ls) => [
      ...ls,
      { key: `n${keyer.current++}`, isNew: true, category: '', type: '', transportName: '', rate: '' },
    ]);

  const removeLine = async (line: Line) => {
    if (!line.id) {
      setLines((ls) => ls.filter((l) => l.key !== line.key));
      return;
    }
    const ok = await confirm({
      title: 'Delete transport rate?',
      description: `Remove the rate for "${line.category} / ${line.type}"?`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(line.id, {
      onSuccess: () => toast.success('Rate deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const save = () => {
    if (!customer.trim()) return toast.error('Select a customer first');
    const payload = lines
      .filter((l) => l.category.trim() !== '' && l.type.trim() !== '' && l.rate.trim() !== '')
      .map((l) => ({
        category: l.category.trim(),
        type: l.type.trim(),
        transportName: l.transportName.trim() || null,
        rate: Number(l.rate),
      }));
    if (payload.length === 0) return toast.error('Enter at least one rate');
    bulk.mutate(
      { customerName: customer.trim(), rates: payload },
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

  const transporterNames = (lookups?.transporters ?? []).map((t) => t.name);
  const priced = lines.filter((l) => l.rate.trim() !== '').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Customer Transport Rates</h2>
          <p className="text-muted-foreground text-sm">
            Pick a customer, fill the transporter &amp; rate for each category × type, then save.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('transrate:export') && <ExportButton onClick={() => exportTransRates()} />}
          {can('transrate:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
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
              Choose a customer to view and fill their transport rates.
            </p>
          ) : (
            <>
              <div className="max-h-[55vh] overflow-auto rounded-lg border">
                <Table className="[&_tbody_td]:bg-card [&_tbody_tr:nth-child(even)_td]:bg-slate-50">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky top-0 z-10 bg-muted">Category</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-muted">Type</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-muted">Transporter</TableHead>
                      <TableHead className="sticky top-0 z-10 w-36 bg-muted text-right">Rate</TableHead>
                      <TableHead className="sticky top-0 z-10 w-12 bg-muted" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isFetching && lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                          <Loader2 className="mx-auto size-5 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                          No category × type combinations yet — use “Add row” below.
                        </TableCell>
                      </TableRow>
                    ) : (
                      lines.map((line) => (
                        <TableRow key={line.key}>
                          <TableCell className={line.isNew ? '' : 'font-medium'}>
                            {line.isNew ? (
                              <Combo
                                value={line.category}
                                onChange={(v) => setField(line.key, { category: v })}
                                options={lookups?.categories ?? []}
                                placeholder="Category"
                              />
                            ) : (
                              line.category
                            )}
                          </TableCell>
                          <TableCell>
                            {line.isNew ? (
                              <Combo
                                value={line.type}
                                onChange={(v) => setField(line.key, { type: v })}
                                options={lookups?.types ?? []}
                                placeholder="Type"
                              />
                            ) : (
                              line.type
                            )}
                          </TableCell>
                          <TableCell>
                            <Combo
                              value={line.transportName}
                              onChange={(v) => setField(line.key, { transportName: v })}
                              options={transporterNames}
                              placeholder="Transporter"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              placeholder="—"
                              className="text-right tabular-nums"
                              value={line.rate}
                              onChange={(e) => setField(line.key, { rate: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            {(line.id || line.isNew) && (
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
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={addRow}>
                    <Plus /> Add row
                  </Button>
                  <p className="text-muted-foreground text-sm">
                    <span className="text-foreground font-medium tabular-nums">{priced}</span> of {lines.length} priced
                  </p>
                </div>
                {can('transrate:update') && (
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
