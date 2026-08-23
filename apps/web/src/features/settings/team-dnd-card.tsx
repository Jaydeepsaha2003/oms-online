import { useEffect, useMemo, useState } from 'react';
import { BellOff, Check, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { isWithinDnd, type NotificationDndDto, type UserDndRow } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RowCheckbox } from '@/components/common/row-checkbox';
import {
  useAllNotificationDnd,
  useClearUserNotificationDnd,
  useDefaultNotificationDnd,
  useSetUserNotificationDnd,
  useUpdateDefaultNotificationDnd,
} from './use-settings';

const CAPTION = 'text-[10.5px] font-bold tracking-[0.09em] text-slate-500 uppercase dark:text-slate-400';

/**
 * Quiet hours for the whole team: one company default, plus per-person overrides.
 *
 * There ARE two layers now, and one sentence covers the whole rule: YOUR OWN
 * SETTING WINS, otherwise the company default applies. (An earlier version of
 * this card refused a second layer on the grounds that precedence is a thing
 * people have to remember — but making every person opt in individually meant
 * quiet hours were off for almost everybody, which is worse. A default that
 * covers everyone and a stated override rule is the better trade.)
 *
 * An override is a stored ROW, not just a differing value. That is what lets
 * "off for me" be a real answer: someone who deliberately opts out of a
 * company-wide quiet window stays opted out when that window later changes.
 * "Use default" deletes the row and puts them back on the default.
 *
 * Three ways to work, because all three are real:
 *   - everyone — set the default once, at the top; most sites never go further;
 *   - per user — change one person's row, which saves on its own and overrides;
 *   - many at once — tick several people and apply one window to all of them,
 *     which is how a shift ("nobody on the floor after 21:00") actually gets set.
 */
export function TeamDndCard() {
  const { data, isLoading } = useAllNotificationDnd();
  const save = useSetUserNotificationDnd();
  const { data: def } = useDefaultNotificationDnd();
  const saveDefault = useUpdateDefaultNotificationDnd();
  const clearFor = useClearUserNotificationDnd();
  const [defStart, setDefStart] = useState('');
  const [defEnd, setDefEnd] = useState('');
  useEffect(() => {
    if (def) {
      setDefStart(def.start);
      setDefEnd(def.end);
    }
  }, [def]);
  /** One writer, so a change to any one field carries the other two along
   *  rather than posting a half-formed window. */
  const saveDefaultWith = (patch: Partial<NotificationDndDto>) =>
    saveDefault.mutate(
      { enabled: def?.enabled ?? false, start: defStart || '21:00', end: defEnd || '08:00', ...patch },
      {
        onSuccess: (v) =>
          toast.success(v.enabled ? `Default quiet hours ${v.start}–${v.end} for everyone` : 'Default quiet hours off'),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save the default')),
      },
    );

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkStart, setBulkStart] = useState('21:00');
  const [bulkEnd, setBulkEnd] = useState('08:00');
  const [busy, setBusy] = useState<string | null>(null);

  const rows = data ?? [];
  const quietNow = useMemo(() => rows.filter((r) => isWithinDnd(r)).length, [rows]);
  const onCount = rows.filter((r) => r.enabled).length;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const saveRow = (row: UserDndRow, patch: Partial<UserDndRow>) => {
    const next = { enabled: row.enabled, start: row.start, end: row.end, ...patch };
    setBusy(row.userId);
    save.mutate(
      { userId: row.userId, ...next },
      {
        onSuccess: (v) => toast.success(v.enabled ? `${v.name}: quiet ${v.start}–${v.end}` : `${v.name}: quiet hours off`),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save')),
        onSettled: () => setBusy(null),
      },
    );
  };

  /* Applied one request per user rather than one bulk endpoint: the same
   * validation, audit trail and error path as a single edit, and a failure on
   * one person does not silently take the rest with it. */
  const applyToPicked = async (enabled: boolean) => {
    const targets = rows.filter((r) => picked.has(r.userId));
    if (!targets.length) return;
    let ok = 0;
    for (const t of targets) {
      try {
        await save.mutateAsync({ userId: t.userId, enabled, start: bulkStart, end: bulkEnd });
        ok += 1;
      } catch (e) {
        toast.error(`${t.name}: ${getApiErrorMessage(e, 'could not save')}`);
      }
    }
    if (ok) {
      toast.success(
        enabled ? `Quiet ${bulkStart}–${bulkEnd} set for ${ok} ${ok === 1 ? 'person' : 'people'}` : `Quiet hours off for ${ok}`,
      );
    }
    setPicked(new Set());
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[15px]">
          <Users className="size-4 text-indigo-600" /> Team quiet hours
          {!isLoading && (
            <span className="text-muted-foreground text-[11.5px] font-medium">
              {onCount} of {rows.length} on
              {quietNow > 0 && <span className="ml-1 font-bold text-indigo-600 dark:text-indigo-400">· {quietNow} quiet right now</span>}
            </span>
          )}
        </CardTitle>
        <p className="text-muted-foreground text-[12px]">
          Set the default once and it applies to everyone. Anyone can be given their own hours instead, or put back on the
          default. A reminder landing inside someone's window waits for it to end — nothing is lost.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/*
          * The company default comes FIRST, because it is what most rows below
          * are actually following — setting it once is the whole job, and the
          * per-person rows exist for the exceptions.
          */}
        <div className="rounded-md border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-500/30 dark:bg-sky-500/10">
          <div className="flex flex-wrap items-center gap-2">
            <Users className="size-4 shrink-0 text-sky-700 dark:text-sky-300" />
            <span className="text-[13px] font-bold text-sky-900 dark:text-sky-100">Default for everyone</span>
            <span className="text-[11.5px] text-sky-800/80 dark:text-sky-200/80">
              applies to all {rows.length || ''} {rows.length === 1 ? 'person' : 'people'} who have not set their own
            </span>
            <Switch
              className="ml-auto"
              checked={def?.enabled ?? false}
              disabled={saveDefault.isPending}
              onCheckedChange={(v) => saveDefaultWith({ enabled: v })}
            />
          </div>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-[7rem_7rem_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="def-from" className={CAPTION}>From</Label>
              <Input
                id="def-from"
                type="time"
                value={defStart}
                disabled={!def?.enabled}
                onChange={(e) => setDefStart(e.target.value)}
                onBlur={(e) => e.target.value !== def?.start && saveDefaultWith({ start: e.target.value })}
                className="h-9 w-full tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="def-to" className={CAPTION}>Until</Label>
              <Input
                id="def-to"
                type="time"
                value={defEnd}
                disabled={!def?.enabled}
                onChange={(e) => setDefEnd(e.target.value)}
                onBlur={(e) => e.target.value !== def?.end && saveDefaultWith({ end: e.target.value })}
                className="h-9 w-full tabular-nums"
              />
            </div>
            <p className="text-[11.5px] text-sky-800/80 sm:pb-1.5 dark:text-sky-200/80">
              {def?.enabled
                ? `Everyone on the default is quiet ${def.start} to ${def.end}${def.start > def.end ? ' (overnight)' : ''}.`
                : 'Off — nobody is muted unless they set their own hours.'}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading people…
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-md border border-slate-200 dark:border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className={cn('border-b border-slate-200 bg-slate-50 text-left dark:border-white/10 dark:bg-white/[0.03]', CAPTION)}>
                    <th className="w-8 py-2 pl-2" />
                    <th className="py-2 pr-2">Person</th>
                    <th className="w-20 py-2 pr-2 text-center">Quiet</th>
                    <th className="w-28 py-2 pr-2">From</th>
                    <th className="w-28 py-2 pr-3">Until</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const nowQuiet = isWithinDnd(r);
                    return (
                      <tr
                        key={r.userId}
                        className={cn(
                          'border-t border-slate-100 dark:border-white/5',
                          picked.has(r.userId) && 'bg-slate-100 dark:bg-white/10',
                        )}
                      >
                        <td className="py-1.5 pl-2">
                          <RowCheckbox
                            checked={picked.has(r.userId)}
                            onChange={() => toggle(r.userId)}
                            label={`Select ${r.name}`}
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold">{r.name}</span>
                            {nowQuiet && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                                <BellOff className="size-2.5" /> Quiet now
                              </span>
                            )}
                            {r.status !== 'active' && (
                              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                {r.status}
                              </span>
                            )}
                            {busy === r.userId && <Loader2 className="text-muted-foreground size-3 animate-spin" />}
                          </div>
                          <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="truncate">{r.email}</span>
                            {r.source === 'default' ? (
                              <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                                following default
                              </span>
                            ) : (
                              <>
                                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                                  own hours
                                </span>
                                {/* The way back. Without it an override is a
                                    one-way door and the default stops meaning
                                    anything for that person for ever. */}
                                <button
                                  type="button"
                                  className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                                  onClick={() =>
                                    clearFor.mutate(r.userId, {
                                      onSuccess: () => toast.success(`${r.name} is back on the default`),
                                      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not reset')),
                                    })
                                  }
                                >
                                  use default
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 pr-2 text-center">
                          <Switch checked={r.enabled} onCheckedChange={(v) => saveRow(r, { enabled: v })} />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            type="time"
                            aria-label={`Quiet hours start for ${r.name}`}
                            defaultValue={r.start}
                            disabled={!r.enabled}
                            // Saved on blur, not on every keystroke: a time input
                            // emits a value on each segment, and "0" then "09"
                            // would fire two writes, the first one invalid.
                            onBlur={(e) => e.target.value !== r.start && saveRow(r, { start: e.target.value })}
                            className="h-8 w-full text-[13px] tabular-nums"
                          />
                        </td>
                        <td className="py-1.5 pr-3">
                          <Input
                            type="time"
                            aria-label={`Quiet hours end for ${r.name}`}
                            defaultValue={r.end}
                            disabled={!r.enabled}
                            onBlur={(e) => e.target.value !== r.end && saveRow(r, { end: e.target.value })}
                            className="h-8 w-full text-[13px] tabular-nums"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Only appears once people are ticked, so one-person edits stay simple. */}
            {picked.size > 0 && (
              <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-300 bg-slate-100 p-3 dark:border-white/20 dark:bg-white/[0.07]">
                <span className={cn(CAPTION, 'pb-2')}>
                  {picked.size} selected
                </span>
                <div className="space-y-1">
                  <Label htmlFor="bulk-from" className={CAPTION}>
                    From
                  </Label>
                  <Input
                    id="bulk-from"
                    type="time"
                    value={bulkStart}
                    onChange={(e) => setBulkStart(e.target.value)}
                    className="h-9 w-28 tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bulk-to" className={CAPTION}>
                    Until
                  </Label>
                  <Input
                    id="bulk-to"
                    type="time"
                    value={bulkEnd}
                    onChange={(e) => setBulkEnd(e.target.value)}
                    className="h-9 w-28 tabular-nums"
                  />
                </div>
                <Button size="sm" className="h-9" disabled={save.isPending} onClick={() => void applyToPicked(true)}>
                  {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} Apply to selected
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={save.isPending}
                  onClick={() => void applyToPicked(false)}
                >
                  Turn off for selected
                </Button>
                <button
                  type="button"
                  onClick={() => setPicked(new Set())}
                  className="text-muted-foreground hover:text-foreground ml-auto cursor-pointer text-xs"
                >
                  Clear
                </button>
              </div>
            )}

            <p className="text-muted-foreground text-[11.5px]">
              Set the end earlier than the start to cover overnight — 21:00 until 08:00 is read as one night, not two.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
