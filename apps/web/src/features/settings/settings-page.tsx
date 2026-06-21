import { useState } from 'react';
import { Loader2, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SETTING_GROUP_META, type OrderOptionDto, type SettingGroupMeta } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateOrderOption, useDeleteOrderOption, useSettings } from './use-settings';

export function SettingsPage() {
  const { data: all, isLoading } = useSettings();
  const { can } = usePermissions();
  const canEdit = can('setting:update');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <SettingsIcon className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
          <p className="text-muted-foreground text-sm">Manage the option lists used across the app.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        SETTING_GROUP_META.map((meta) => (
          <GroupCard key={meta.group} meta={meta} options={all ?? []} canEdit={canEdit} />
        ))
      )}
    </div>
  );
}

function GroupCard({
  meta,
  options,
  canEdit,
}: {
  meta: SettingGroupMeta;
  options: OrderOptionDto[];
  canEdit: boolean;
}) {
  const [value, setValue] = useState('');
  const create = useCreateOrderOption();
  const del = useDeleteOrderOption();

  const items = options
    .filter((o) => o.group === meta.group)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const add = () => {
    const v = value.trim();
    if (!v) return;
    if (meta.numeric && Number.isNaN(Number(v))) return toast.error('Enter a number');
    create.mutate(
      { group: meta.group, value: v },
      {
        onSuccess: () => setValue(''),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not add')),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{meta.label}</CardTitle>
        <p className="text-muted-foreground text-xs">{meta.description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {items.length === 0 && <span className="text-muted-foreground text-sm">No options yet.</span>}
          {items.map((o) => (
            <span
              key={o.id}
              className="bg-muted inline-flex items-center gap-1.5 rounded-full border py-1 pr-1 pl-3 text-sm"
            >
              <span className="font-medium tabular-nums">{o.value}</span>
              {canEdit && (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-5 items-center justify-center rounded-full transition-colors"
                  onClick={() =>
                    del.mutate(o.id, { onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')) })
                  }
                  aria-label={`Remove ${o.value}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>

        {canEdit && (
          <div className="flex max-w-xs gap-2">
            <Input
              type={meta.numeric ? 'number' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
              placeholder={meta.placeholder}
              className={meta.numeric ? '' : 'uppercase'}
            />
            <Button onClick={add} disabled={create.isPending || !value.trim()}>
              <Plus /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
