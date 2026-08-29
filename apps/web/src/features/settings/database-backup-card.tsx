import { useRef, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, DatabaseBackup, Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFile, getApiErrorMessage, http } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** What the server reports after a restore. */
interface RestoreResult {
  safetyBackup: string;
  size: number;
  counts: { table: string; rows: number }[];
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
/** Typed to confirm. A checkbox is too easy to tick past for this one. */
const CONFIRM_WORD = 'RESTORE';

/**
 * Download a full backup of the database, and put one back.
 *
 * The two halves are deliberately not alike: downloading is safe and one click,
 * restoring discards every row the app currently holds and asks the user to
 * type the word first.
 */
export function DatabaseBackupCard() {
  const { can } = usePermissions();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /* Set when the server refuses a backup only for being from a newer build.
     Ticking it re-sends with `allowNewer`, which is the one check the person
     doing the restore is better placed to make than a blanket rule. */
  const [newerWarning, setNewerWarning] = useState<string | null>(null);
  const [allowNewer, setAllowNewer] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canRestore = can('backup:import');

  const download = async () => {
    setBusy(true);
    try {
      // The server names the file (oms-backup-<date>.db) via Content-Disposition.
      await downloadFile('/backup/database', 'oms-backup.db');
      toast.success('Backup downloaded');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Backup failed'));
    } finally {
      setBusy(false);
    }
  };

  const pick = (f: File | null) => {
    setFile(f);
    setConfirmText('');
    setResult(null);
    setNewerWarning(null);
    setAllowNewer(false);
  };

  const restore = async () => {
    if (!file || confirmText.trim().toUpperCase() !== CONFIRM_WORD) return;
    setRestoring(true);
    try {
      const body = new FormData();
      body.append('file', file);
      if (allowNewer) body.append('allowNewer', 'true');
      const res = await http.post<RestoreResult>('/backup/restore', body);
      setResult(res);
      setConfirmOpen(false);
      pick(null);
      if (fileInput.current) fileInput.current.value = '';
      toast.success('Database restored');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Restore failed');
      /*
       * "From a newer build" is the one refusal that can be overridden, so it
       * stays in the dialog with a tick box instead of vanishing as a toast —
       * the file is still chosen and the decision is right there.
       */
      const code = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)?.error
        : undefined;
      if (code === 'BACKUP_NEWER') setNewerWarning(message);
      else toast.error(message, { duration: 12_000 });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DatabaseBackup className="text-primary size-4" /> Database backup
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Download the whole database — orders, challans, customers, accounts, users, everything —
          as one SQLite file. Safe to run while the app is in use. Keep a copy somewhere off this
          machine.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <Button onClick={download} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          {busy ? 'Preparing backup…' : 'Download backup'}
        </Button>

        {canRestore && (
          <div className="border-destructive/25 bg-destructive/[0.03] space-y-3 rounded-md border p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] font-bold">Restore from a backup</p>
                <p className="text-muted-foreground text-xs">
                  Replaces <span className="font-semibold">everything</span> in the live database
                  with the contents of a backup file. Work done since that backup was taken is lost.
                  The database being replaced is saved first, so a mistake can be undone.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="restore-file"
                className="text-[11px] font-bold uppercase tracking-wide"
              >
                Backup file (.db)
              </Label>
              <Input
                id="restore-file"
                ref={fileInput}
                type="file"
                accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/octet-stream"
                className="h-9 text-[12.5px]"
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              {file && (
                <p className="text-muted-foreground text-xs">
                  {file.name} · {mb(file.size)}
                </p>
              )}
            </div>

            <Button
              variant="destructive"
              disabled={!file}
              onClick={() => {
                setConfirmText('');
                setConfirmOpen(true);
              }}
            >
              <Upload /> Restore this file
            </Button>

            {result && (
              <div className="space-y-1 rounded-md border border-emerald-300 bg-emerald-50 p-2.5 text-xs dark:border-emerald-400/30 dark:bg-emerald-400/10">
                <p className="font-bold text-emerald-800 dark:text-emerald-300">
                  Restored — {mb(result.size)} now live
                </p>
                <p className="text-emerald-900/80 dark:text-emerald-200/80">
                  {result.counts
                    .map((c) => `${c.rows.toLocaleString('en-IN')} ${c.table}`)
                    .join(' · ')}
                </p>
                <p className="text-emerald-900/70 dark:text-emerald-200/70">
                  The database that was replaced is at{' '}
                  <span className="font-mono break-all">{result.safetyBackup}</span>
                </p>
              </div>
            )}
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          A backup can only be restored onto a server running the same version of the app it came
          from — an older one is refused rather than left half-working.
        </p>
      </CardContent>

      {/* The confirmation lives in its own dialog, so the destructive click is
          never the one already under the cursor. */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!restoring) setConfirmOpen(o);
        }}
      >
        <DialogContent className="font-poppins sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="size-4" /> Replace the whole database?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-[13px]">
            <p>
              Every order, challan, customer, payment and user in the live database will be replaced
              by the contents of <span className="font-semibold">{file?.name}</span>.
            </p>
            <p className="text-muted-foreground">
              The current database is snapshotted first, and the file it replaces is kept alongside
              it — so this can be undone by restoring that snapshot.
            </p>
            {newerWarning && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-400/30 dark:bg-amber-400/10">
                <p className="text-[12.5px] font-semibold text-amber-900 dark:text-amber-200">
                  {newerWarning}
                </p>
                <label className="flex cursor-pointer items-start gap-2 text-[12.5px] font-medium text-amber-900 dark:text-amber-200">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 cursor-pointer"
                    checked={allowNewer}
                    onChange={(e) => setAllowNewer(e.target.checked)}
                  />
                  <span>Restore it anyway — those changes do not affect this server.</span>
                </label>
              </div>
            )}

            <div className="space-y-1.5">
              <Label
                htmlFor="confirm-word"
                className="text-[11px] font-bold uppercase tracking-wide"
              >
                Type {CONFIRM_WORD} to confirm
              </Label>
              <Input
                id="confirm-word"
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_WORD}
                className="h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={restoring}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={restore}
              disabled={
                restoring ||
                confirmText.trim().toUpperCase() !== CONFIRM_WORD ||
                (!!newerWarning && !allowNewer)
              }
            >
              {restoring ? <Loader2 className="animate-spin" /> : <Upload />}
              {restoring ? 'Restoring…' : 'Replace the database'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
