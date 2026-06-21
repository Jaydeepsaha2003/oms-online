import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combo, NativeSelect } from '@/components/common/combo';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useBulkTransRates,
  useDeleteTransRate,
  useTransLookups,
  useTransRatesByCustomer,
} from './use-trans-rates';

interface Line {
  key: string;
  id?: number;
  isNew?: boolean;
  category: string;
  type: string;
  transportName: string;
  rate: string;
}

/**
 * The fillable "transport rate per category × type" grid for ONE customer. Reused
 * by the Transport Rates page ("Fill by customer") and the customer edit page.
 */
export function CustomerTransRates({ customerName }: { customerName: string }) {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { data: lookups } = useTransLookups();
  const { data: rates, isFetching } = useTransRatesByCustomer(customerName);
  const bulk = useBulkTransRates();
  const del = useDeleteTransRate();
  const keyer = useRef(0);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
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
  }, [rates, lookups]);

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
      { customerName, rates: payload },
      {
        onSuccess: (res) => toast.success(`Saved ${res.saved} rate(s)`),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );
  };

  const transporterNames = (lookups?.transporters ?? []).map((t) => t.name);
  const priced = lines.filter((l) => l.rate.trim() !== '').length;

  return (
    <div className="space-y-4">
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
                      <NativeSelect
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
    </div>
  );
}
