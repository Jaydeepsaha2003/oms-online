import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Mic, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAiStatus, useVoiceChecklist } from './use-crm';
import { startVoiceRecording, type VoiceRecorder } from './voice-recorder';
import { useMicrophoneStatus } from './use-microphone-status';

export interface ChecklistDraftItem {
  text: string;
  source?: 'MANUAL' | 'VOICE';
}

/** A multi-add list you build by typing OR speaking (Gemini splits Hindi/English
 *  speech into short items). Reused for both the task checklist and the notes /
 *  discussion list on the New-follow-up form. */
export function ChecklistBlock({
  items,
  onChange,
  placeholder = 'Type a task and press Enter…',
  noun = 'task',
  showSetupHint = true,
}: {
  items: ChecklistDraftItem[];
  onChange: (items: ChecklistDraftItem[]) => void;
  placeholder?: string;
  noun?: string;
  showSetupHint?: boolean;
}) {
  const navigate = useNavigate();
  const { data: ai } = useAiStatus();
  const voice = useVoiceChecklist();
  const micStatus = useMicrophoneStatus();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'recording' | 'thinking'>('idle');
  const recorder = useRef<VoiceRecorder | null>(null);

  const add = (t: string, source: 'MANUAL' | 'VOICE' = 'MANUAL') => {
    const v = t.trim();
    if (!v) return;
    onChange([...items, { text: v, source }]);
  };
  const addTyped = () => { add(text); setText(''); };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  const startRec = async () => {
    try {
      recorder.current = await startVoiceRecording();
      setPhase('recording');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the microphone.');
      setPhase('idle');
    }
  };
  const stopRec = async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setPhase('thinking');
    try {
      const { base64, mimeType } = await rec.stop();
      if (!base64) throw new Error('Nothing was recorded — try again.');
      const res = await voice.mutateAsync({ audio: base64, mimeType });
      if (res.items.length === 0) {
        toast.message(`Heard you, but found no ${noun}s`, { description: res.transcript || res.summary || `Try speaking the ${noun}s clearly.` });
      } else {
        onChange([...items, ...res.items.map((t) => ({ text: t, source: 'VOICE' as const }))]);
        toast.success(`Added ${res.items.length} ${noun}${res.items.length > 1 ? 's' : ''} from your voice`, { description: res.summary || res.transcript });
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Voice could not be processed.'));
    } finally {
      setPhase('idle');
    }
  };
  const cancelRec = () => { recorder.current?.cancel(); recorder.current = null; setPhase('idle'); };

  const micDisabled = phase === 'thinking';
  return (
    <div className="space-y-2.5">
      {/* type-to-add + mic */}
      <div className="flex gap-2">
        <Input
          className="h-11"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" className="h-11 shrink-0" onClick={addTyped} disabled={!text.trim()}><Plus className="size-4" /></Button>
        {phase === 'recording' ? (
          <Button type="button" className="h-11 shrink-0 animate-pulse bg-rose-600 px-4 hover:bg-rose-700" onClick={stopRec}>
            <Square className="size-4 fill-current" /> Stop
          </Button>
        ) : phase === 'thinking' ? (
          <Button type="button" className="h-11 shrink-0 px-4" disabled><Loader2 className="size-4 animate-spin" /> Reading…</Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 border-blue-300 px-4 text-blue-700 hover:bg-blue-50"
            onClick={startRec}
            disabled={micDisabled || !micStatus.canRecord}
            title={
              !micStatus.isSecure
                ? 'Microphone requires a secure connection (HTTPS)'
                : micStatus.hasMic === false
                ? 'No microphone detected'
                : 'Speak your tasks (Hindi or English)'
            }
          >
            <Mic className="size-4" /> Speak
          </Button>
        )}
      </div>

      {phase === 'recording' && (
        <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span className="inline-flex items-center gap-2"><span className="size-2 animate-pulse rounded-full bg-rose-600" /> Listening… speak your tasks, then tap <b>Stop</b>.</span>
          <button type="button" onClick={cancelRec} className="text-rose-500 hover:text-rose-700"><X className="size-4" /></button>
        </div>
      )}

      {phase === 'idle' && (
        <div className="space-y-1.5">
          {!micStatus.isSecure && (
            <p className="text-xs text-amber-600 font-medium flex items-center gap-1">
              <span>⚠️</span> Microphone requires a secure connection (HTTPS or localhost). Access via HTTPS to enable.
            </p>
          )}
          {micStatus.isSecure && micStatus.hasMic === false && (
            <p className="text-xs text-amber-600 font-medium flex items-center gap-1">
              <span>⚠️</span> No microphone detected. Please connect a microphone.
            </p>
          )}
          {showSetupHint && ai && !ai.configured && (
            <div>
              <button type="button" onClick={() => navigate('/settings')} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs">
                <Sparkles className="size-3.5 text-amber-500" /> Turn on voice input — add your free Gemini key in Settings
              </button>
            </div>
          )}
        </div>
      )}

      {/* items */}
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
              <span className={cn('flex size-5 shrink-0 items-center justify-center rounded border', it.source === 'VOICE' ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-slate-300 text-slate-400')}>
                {it.source === 'VOICE' ? <Mic className="size-3" /> : <Check className="size-3" />}
              </span>
              <span className="flex-1">{it.text}</span>
              <button type="button" onClick={() => remove(i)} className="text-slate-300 hover:text-rose-500"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
