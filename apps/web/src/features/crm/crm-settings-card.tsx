import { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Loader2, Mic, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAiStatus, useCrmSettings, useSaveAiConfig, useSaveCrmSettings } from './use-crm';

/** Global defaults for the CRM "anti-forget" reminder loop. Per follow-up can override the interval + daily cap. */
export function CrmReminderCard() {
  const { can } = usePermissions();
  const canEdit = can('crm:update');
  const { data } = useCrmSettings();
  const save = useSaveCrmSettings();
  const [form, setForm] = useState<Record<string, string | boolean>>({});

  useEffect(() => {
    if (data) setForm({ ...data } as unknown as Record<string, string | boolean>);
  }, [data]);

  if (!can('crm:view')) return null;
  const num = (k: string) => (form[k] === '' || form[k] == null ? 0 : Number(form[k]));
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const onSave = () => {
    save.mutate(
      {
        intervalMins: num('intervalMins'),
        maxRemindersPerDay: num('maxRemindersPerDay'),
        leadDays: num('leadDays'),
        workStartHour: num('workStartHour'),
        workEndHour: num('workEndHour'),
        sound: !!form.sound,
        desktopNotifications: !!form.desktopNotifications,
      },
      { onSuccess: () => toast.success('Reminder settings saved'), onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-amber-600" /> Follow-up reminders
        </CardTitle>
        <p className="text-muted-foreground text-sm">How the "anti-forget" reminder loop nudges. A single follow-up can override the interval &amp; daily cap.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Remind every (mins)"><Input type="number" min="1" disabled={!canEdit} value={String(form.intervalMins ?? '')} onChange={(e) => set('intervalMins', e.target.value)} /></Field>
          <Field label="Max reminders / day"><Input type="number" min="0" disabled={!canEdit} value={String(form.maxRemindersPerDay ?? '')} onChange={(e) => set('maxRemindersPerDay', e.target.value)} /><span className="text-muted-foreground text-[11px]">0 = unlimited</span></Field>
          <Field label="Flag this many days early"><Input type="number" min="0" disabled={!canEdit} value={String(form.leadDays ?? '')} onChange={(e) => set('leadDays', e.target.value)} /></Field>
          <Field label="Quiet hours — from"><Input type="number" min="0" max="23" disabled={!canEdit} value={String(form.workStartHour ?? '')} onChange={(e) => set('workStartHour', e.target.value)} /></Field>
          <Field label="…until (24h)"><Input type="number" min="1" max="24" disabled={!canEdit} value={String(form.workEndHour ?? '')} onChange={(e) => set('workEndHour', e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm"><Switch checked={!!form.sound} disabled={!canEdit} onCheckedChange={(v) => set('sound', v)} /> Play a chime</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={!!form.desktopNotifications} disabled={!canEdit} onCheckedChange={(v) => set('desktopNotifications', v)} /> Desktop notifications</label>
        </div>
        {canEdit && (
          <Button onClick={onSave} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : null} Save reminder settings</Button>
        )}

        {/* Voice input (Gemini) */}
        <VoiceKeySection canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}

/** Groq API key for voice → checklist. Stored server-side; never shown back. */
function VoiceKeySection({ canEdit }: { canEdit: boolean }) {
  const { data: ai } = useAiStatus();
  const saveAi = useSaveAiConfig();
  const [key, setKey] = useState('');

  const save = () => {
    if (!key.trim()) return toast.error('Paste your Groq API key first.');
    saveAi.mutate({ apiKey: key.trim() }, { onSuccess: () => { toast.success('Voice input enabled'); setKey(''); }, onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) });
  };
  const clear = () => saveAi.mutate({ apiKey: '' }, { onSuccess: () => toast.success('Key removed') });

  return (
    <div className="mt-1 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="mb-1 flex items-center gap-2">
        <Mic className="size-4 text-blue-600" />
        <span className="text-[15px] font-semibold">Voice input (Groq API)</span>
        {ai?.configured && <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 className="size-3.5" /> Enabled</span>}
      </div>
      <p className="text-muted-foreground mb-3 text-sm">
        Lets you <b>speak</b> the checklist in Hindi or English on the follow-up form. Get a free key at{' '}
        <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-blue-600 underline">console.groq.com/keys</a> and paste it here — it stays on the server.
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Input className="h-11 flex-1" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={ai?.configured ? 'Enter a new key to replace…' : 'Paste your Groq API key (gsk_…)'} />
          <Button className="h-11" onClick={save} disabled={saveAi.isPending}>{saveAi.isPending ? <Loader2 className="animate-spin" /> : <Sparkles className="size-4" />} {ai?.configured ? 'Replace' : 'Enable'}</Button>
          {ai?.configured && <Button variant="outline" className="h-11" onClick={clear} disabled={saveAi.isPending}>Remove</Button>}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
