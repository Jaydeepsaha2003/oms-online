import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ReconRunResult } from '@oms/shared';
import { api } from '@/lib/api';

/**
 * Owns an in-flight Tally reconciliation.
 *
 * The request deliberately lives here rather than in the page: reconciling a
 * year's register takes a few seconds of server work, and the user is free to
 * walk off to another screen while it runs. This provider is mounted in the app
 * shell, which stays mounted across navigation, so the upload, the progress and
 * the completion notice all survive leaving `/account/tally-recon` — and the
 * finished report is waiting when they come back.
 *
 * A full browser reload still abandons it (nothing survives that), so a live run
 * arms the browser's own "leave site?" prompt.
 */

export type ReconPhase = 'idle' | 'uploading' | 'analysing' | 'done' | 'error';

export interface ReconRunState {
  phase: ReconPhase;
  /** Real upload progress, 0-100. Only meaningful while `phase === 'uploading'`. */
  uploadPct: number;
  fileName: string | null;
  /** Wall-clock seconds since the run started, ticked once a second. */
  elapsed: number;
  result: ReconRunResult | null;
  error: string | null;
}

interface ReconRunApi extends ReconRunState {
  busy: boolean;
  start: (file: File) => Promise<ReconRunResult | null>;
  cancel: () => void;
  /** Clear a finished or failed run's card. */
  dismiss: () => void;
  /** The run the page should jump to, consumed once so a manual pick then sticks. */
  takeFreshRunId: () => number | null;
}

const IDLE: ReconRunState = { phase: 'idle', uploadPct: 0, fileName: null, elapsed: 0, result: null, error: null };

const Ctx = createContext<ReconRunApi | null>(null);

const inr = (v: number) => (v ?? 0).toLocaleString('en-IN');

/** Problems worth pulling the user back to the report for. */
export const problemsOf = (r: ReconRunResult | null): number =>
  r ? r.missingInOms + r.missingInTally + r.mismatchCount + r.unmatchedParty : 0;

export function TallyReconRunProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [state, setState] = useState<ReconRunState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  /** Set when a run finishes; the report page reads it once to select that run. */
  const freshRunId = useRef<number | null>(null);

  const busy = state.phase === 'uploading' || state.phase === 'analysing';

  // Tick the elapsed counter while a run is live.
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => {
      setState((s) => ({ ...s, elapsed: Math.round((Date.now() - startedAt.current) / 1000) }));
    }, 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  // A reload would abandon the run — make the browser ask first.
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [busy]);

  const start = useCallback(
    async (file: File): Promise<ReconRunResult | null> => {
      if (abortRef.current) return null; // one reconciliation at a time
      const controller = new AbortController();
      abortRef.current = controller;
      startedAt.current = Date.now();
      setState({ phase: 'uploading', uploadPct: 0, fileName: file.name, elapsed: 0, result: null, error: null });

      const body = new FormData();
      body.append('file', file);
      try {
        const res = await api.post<ReconRunResult>('/tally-recon/runs', body, {
          signal: controller.signal,
          onUploadProgress: (e) => {
            const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
            // Once the bytes are gone the server is parsing and matching, and there
            // is no honest percentage for that — so the phase changes rather than
            // the bar creeping forward on a guess.
            setState((s) => (s.phase === 'uploading' ? { ...s, uploadPct: pct, phase: pct >= 100 ? 'analysing' : 'uploading' } : s));
          },
        });
        const result = res.data;
        freshRunId.current = result.id;
        setState({
          phase: 'done',
          uploadPct: 100,
          fileName: file.name,
          elapsed: Math.round((Date.now() - startedAt.current) / 1000),
          result,
          error: null,
        });
        void qc.invalidateQueries({ queryKey: ['tally-recon', 'runs'] });

        const problems = problemsOf(result);
        const goto = { label: 'View report', onClick: () => navigate('/account/tally-recon') };
        if (problems) {
          toast.warning(`Reconciliation complete — ${inr(problems)} entries need attention.`, {
            description: `${inr(result.voucherCount)} vouchers across ${inr(result.ledgerCount)} ledgers · ${inr(result.matchedCount)} matched.`,
            duration: 12_000,
            action: goto,
          });
        } else {
          toast.success('Reconciliation complete — everything agrees.', {
            description: `${inr(result.voucherCount)} vouchers across ${inr(result.ledgerCount)} ledgers matched cleanly.`,
            duration: 10_000,
            action: goto,
          });
        }
        return result;
      } catch (e) {
        if (controller.signal.aborted) {
          setState(IDLE);
          toast.info('Reconciliation cancelled.');
          return null;
        }
        const message = e instanceof Error ? e.message : 'Could not reconcile that register.';
        setState({
          phase: 'error',
          uploadPct: 0,
          fileName: file.name,
          elapsed: Math.round((Date.now() - startedAt.current) / 1000),
          result: null,
          error: message,
        });
        toast.error('Reconciliation failed.', { description: message, duration: 12_000 });
        return null;
      } finally {
        abortRef.current = null;
      }
    },
    [qc, navigate],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const dismiss = useCallback(() => setState(IDLE), []);
  const takeFreshRunId = useCallback(() => {
    const id = freshRunId.current;
    freshRunId.current = null;
    return id;
  }, []);

  const value = useMemo<ReconRunApi>(
    () => ({ ...state, busy, start, cancel, dismiss, takeFreshRunId }),
    [state, busy, start, cancel, dismiss, takeFreshRunId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTallyReconRun(): ReconRunApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTallyReconRun must be used inside <TallyReconRunProvider>.');
  return ctx;
}
