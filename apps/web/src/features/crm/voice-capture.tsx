import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Mic, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAiStatus, useVoiceChecklist } from './use-crm';
import { type VoiceRecorder } from './voice-recorder';
import { useMicAccess } from './mic-permission';
import { useMicrophoneStatus } from './use-microphone-status';

/** Compose Gemini's result into a description — a one-liner, or multi-line bullets. */
function compose(summary: string, items: string[], transcript: string): string {
  if (items.length > 1) return [summary, ...items.map((i) => `• ${i}`)].filter(Boolean).join('\n');
  if (items.length === 1) return summary && summary !== items[0] ? `${summary}\n• ${items[0]}` : items[0];
  return summary || transcript;
}

/**
 * One mic → speak anything → Gemini summarises (Hindi/English) → a review card
 * where you confirm or edit → the text is handed back to fill the description.
 * `onConfirm(text)` receives the confirmed 1-line or multi-line message.
 */
export function VoiceCapture({
  onConfirm,
  onVoiceResult,
}: {
  onConfirm: (text: string) => void;
  onVoiceResult?: (result: {
    transcript: string;
    summary: string;
    items: string[];
    detectedCustomer?: string;
    detectedItem?: string;
  }) => void;
}) {
  const navigate = useNavigate();
  const { data: ai } = useAiStatus();
  const voice = useVoiceChecklist();
  const micStatus = useMicrophoneStatus();
  const [phase, setPhase] = useState<'idle' | 'recording' | 'thinking' | 'review'>('idle');
  const [draft, setDraft] = useState('');
  const [transcript, setTranscript] = useState('');
  const recorder = useRef<VoiceRecorder | null>(null);

  const micAccess = useMicAccess((rec) => {
    recorder.current = rec;
    setPhase('recording');
  });
  const start = () => micAccess.begin();
  const stop = async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setPhase('thinking');
    try {
      const { base64, mimeType } = await rec.stop();
      if (!base64) throw new Error('Nothing was recorded — try again.');
      const res = await voice.mutateAsync({ audio: base64, mimeType });
      setTranscript(res.transcript || '');
      setDraft(compose(res.summary, res.items, res.transcript));
      setPhase('review');
      if (onVoiceResult) {
        onVoiceResult(res);
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Voice could not be processed.'));
      setPhase('idle');
    }
  };
  const cancelRec = () => { recorder.current?.cancel(); recorder.current = null; setPhase('idle'); };
  const confirm = () => {
    const t = draft.trim();
    if (!t) { toast.error('Nothing to add.'); return; }
    onConfirm(t);
    setPhase('idle'); setDraft(''); setTranscript('');
    toast.success('Added to the note');
  };

  return (
    <div className="space-y-2">
      {/* trigger */}
      {phase === 'idle' && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 border-blue-300 px-4 text-blue-700 hover:bg-blue-50"
              onClick={start}
              title={micStatus.isSecure ? 'Speak — Hindi or English' : 'Microphone requires a secure connection (HTTPS)'}
            >
              <Mic className="size-4" /> Speak &amp; summarise
            </Button>
            {ai && !ai.configured && (
              <button type="button" onClick={() => navigate('/settings')} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs">
                <Sparkles className="size-3.5 text-amber-500" /> Turn on voice — add your free Gemini key in Settings
              </button>
            )}
          </div>
          {!micStatus.isSecure && (
            <p className="text-xs text-amber-600 font-medium flex items-center gap-1">
              <span>⚠️</span> Microphone requires a secure connection (HTTPS or localhost). Access via HTTPS to enable.
            </p>
          )}
        </div>
      )}

      {micAccess.dialog}

      {phase === 'recording' && (
        <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-rose-700"><span className="size-2.5 animate-pulse rounded-full bg-rose-600" /> Listening… speak now, then tap Stop.</span>
          <div className="flex gap-2">
            <Button type="button" className="h-9 bg-rose-600 hover:bg-rose-700" onClick={stop}><Square className="size-4 fill-current" /> Stop</Button>
            <Button type="button" variant="ghost" size="icon" className="h-9" onClick={cancelRec}><X className="size-4" /></Button>
          </div>
        </div>
      )}

      {phase === 'thinking' && (
        <div className="text-muted-foreground flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-3 text-sm"><Loader2 className="size-4 animate-spin" /> Summarising what you said…</div>
      )}

      {/* review + confirm */}
      {phase === 'review' && (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-800"><Sparkles className="size-4 text-blue-600" /> Here’s what I understood — check &amp; edit, then add</div>
          {transcript && <p className="text-muted-foreground text-xs italic">You said: “{transcript}”</p>}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-9" onClick={confirm}><Check className="size-4" /> Add to note</Button>
            <Button type="button" variant="outline" className="h-9" onClick={start}><RotateCcw className="size-4" /> Re-record</Button>
            <Button type="button" variant="ghost" className="h-9" onClick={() => { setPhase('idle'); setDraft(''); }}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}
