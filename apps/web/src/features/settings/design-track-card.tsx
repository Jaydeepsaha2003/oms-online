import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDesignTrackTypes, useUpdateDesignTrackTypes } from '@/features/design-track/use-design-track';

/**
 * Which design types Dispatch → Design Track is allowed to list.
 *
 * The pick-list is every DISTINCT design type present on order lines — one entry
 * per design however many lines use it. Tracking is opt-in: with nothing picked
 * the grid stays empty rather than listing all ~800 designs, since the screen
 * exists to watch the few designs currently being worked.
 */
export function DesignTrackCard({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useDesignTrackTypes();
  const save = useUpdateDesignTrackTypes();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (data) setSelected(new Set(data.selected));
  }, [data]);

  const available = data?.available ?? [];
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? available.filter((d) => d.toLowerCase().includes(q)) : available;
  }, [available, search]);

  const toggle = (d: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });

  const allVisibleOn = visible.length > 0 && visible.every((d) => selected.has(d));
  const toggleVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((d) => (allVisibleOn ? next.delete(d) : next.add(d)));
      return next;
    });

  const onSave = () =>
    save.mutate(
      { selected: [...selected] },
      {
        onSuccess: () => toast.success('Tracked designs saved'),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-indigo-600" /> Design Track
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Pick the design types Dispatch → Design Track should list. Only distinct designs are offered, and only these
          appear on that screen — nothing selected means the grid stays empty.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs font-semibold">
            {selected.size} of {available.length} tracked
          </span>
          <div className="flex items-center gap-2">
            <div className="relative w-44">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a design…" className="h-8 pl-8 text-sm" />
            </div>
            {canEdit && visible.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={toggleVisible}>
                {allVisibleOn ? 'Clear shown' : 'Select shown'}
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-md border p-2">
            {visible.length === 0 ? (
              <p className="text-muted-foreground p-2 text-sm">
                {available.length === 0 ? 'No design types found on any order line yet.' : `No design matches “${search}”.`}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {visible.map((d) => {
                  const on = selected.has(d);
                  return (
                    <label
                      key={d}
                      className={cn(
                        'flex items-center gap-1.5 rounded-[3px] px-1.5 py-1 text-[12.5px]',
                        canEdit && 'cursor-pointer hover:bg-muted/60',
                        on && 'bg-primary/[0.06]',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="accent-indigo-600 size-3.5"
                        checked={on}
                        disabled={!canEdit}
                        onChange={() => toggle(d)}
                      />
                      <span className="truncate font-medium" title={d}>
                        {d}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {canEdit && (
          <Button onClick={onSave} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null} Save tracked designs
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
