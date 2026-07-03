import { useCallback, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { startVoiceRecording, type VoiceRecorder } from './voice-recorder';

type MicDialogState =
  | { kind: 'closed' }
  | { kind: 'prompting' }
  | { kind: 'denied' }
  | { kind: 'insecure' }
  | { kind: 'no-mic' }
  | { kind: 'error'; message: string };

async function micPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const st = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return st.state;
  } catch {
    return 'unknown'; // older Safari can't report mic permission — just try getUserMedia
  }
}

/**
 * Centered permission flow for the Speak buttons. `begin()` must be called from
 * a click handler (browsers only show the native mic prompt on a user gesture).
 * While the browser's Allow/Block popup is open we show a centered dialog that
 * points the user at it; blocked / insecure / no-mic outcomes each get their own
 * centered explanation instead of a corner toast that's easy to miss.
 */
export function useMicAccess(onReady: (rec: VoiceRecorder) => void) {
  const [state, setState] = useState<MicDialogState>({ kind: 'closed' });
  // Bumped whenever the user dismisses the dialog, so a getUserMedia that
  // resolves after dismissal is discarded instead of starting a recording.
  const attempt = useRef(0);

  const begin = useCallback(async () => {
    if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
      setState({ kind: 'insecure' });
      return;
    }
    const permission = await micPermissionState();
    if (permission === 'denied') {
      setState({ kind: 'denied' });
      return;
    }
    const token = ++attempt.current;
    // Only show the "click Allow" helper when the browser will actually ask.
    if (permission !== 'granted') setState({ kind: 'prompting' });
    try {
      const rec = await startVoiceRecording();
      if (attempt.current !== token) {
        rec.cancel();
        return;
      }
      setState({ kind: 'closed' });
      onReady(rec);
    } catch (e) {
      if (attempt.current !== token) return;
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setState({ kind: 'denied' });
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
        setState({ kind: 'no-mic' });
      } else {
        setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not start the microphone.' });
      }
    }
  }, [onReady]);

  const close = useCallback(() => {
    attempt.current++;
    setState({ kind: 'closed' });
  }, []);

  const dialog = (
    <Dialog open={state.kind !== 'closed'} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-md">
        {state.kind === 'prompting' && (
          <>
            <DialogHeader>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-blue-100 sm:mx-0">
                <Mic className="size-7 text-blue-600" />
              </div>
              <DialogTitle>Allow microphone access</DialogTitle>
              <DialogDescription>
                Your browser is asking for permission right now. Choose <b>Allow</b> in its popup — Chrome shows
                it near the address bar, Safari shows a system dialog — and recording starts immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Waiting for your answer…
            </div>
          </>
        )}

        {state.kind === 'denied' && (
          <>
            <DialogHeader>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-rose-100 sm:mx-0">
                <MicOff className="size-7 text-rose-600" />
              </div>
              <DialogTitle>Microphone is blocked for this site</DialogTitle>
              <DialogDescription>
                The browser remembered an earlier “Block”, so it won’t ask again until you unblock it:
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-1.5 text-sm">
              <li><b>Chrome / Edge:</b> click the icon left of the address bar → Site settings → set <b>Microphone</b> to <b>Allow</b>, then reload.</li>
              <li><b>Safari (Mac):</b> Safari menu → <b>Settings for This Website…</b> → set Microphone to <b>Allow</b>.</li>
              <li><b>Safari (iPhone / iPad):</b> tap <b>ᴀA</b> in the address bar → Website Settings → Microphone → <b>Allow</b>.</li>
            </ul>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => window.location.reload()}>Reload page</Button>
              <Button type="button" onClick={begin}>Try again</Button>
            </DialogFooter>
          </>
        )}

        {state.kind === 'insecure' && (
          <>
            <DialogHeader>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 sm:mx-0">
                <ShieldAlert className="size-7 text-amber-600" />
              </div>
              <DialogTitle>Secure connection needed for the microphone</DialogTitle>
              <DialogDescription>
                Browsers only allow the microphone on <b>HTTPS</b> pages or on <b>localhost</b>. This page was opened
                over plain HTTP (<code>{window.location.host}</code>), so Chrome and Safari disable the microphone
                and will never show the permission popup here.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-1.5 text-sm">
              <li>On the computer running the app, open <b>http://localhost{window.location.port ? `:${window.location.port}` : ''}</b> instead.</li>
              <li>From phones or other devices, the app must be served over <b>HTTPS</b>.</li>
            </ul>
          </>
        )}

        {state.kind === 'no-mic' && (
          <>
            <DialogHeader>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 sm:mx-0">
                <TriangleAlert className="size-7 text-amber-600" />
              </div>
              <DialogTitle>No microphone found</DialogTitle>
              <DialogDescription>
                Connect a microphone, and check the system permission for your browser:
                Windows → Settings → Privacy &amp; security → Microphone; macOS → System Settings →
                Privacy &amp; Security → Microphone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={begin}>Try again</Button>
            </DialogFooter>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <DialogHeader>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-rose-100 sm:mx-0">
                <TriangleAlert className="size-7 text-rose-600" />
              </div>
              <DialogTitle>Could not start the microphone</DialogTitle>
              <DialogDescription>{state.message}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={begin}>Try again</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return { begin, dialog };
}
