import { useState } from 'react';
import { DatabaseBackup, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFile, getApiErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Download a full backup of the database — every table, every row — as a single
 * SQLite file. Hidden unless the user holds `backup:export`.
 */
export function DatabaseBackupCard() {
  const [busy, setBusy] = useState(false);

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DatabaseBackup className="text-primary size-4" /> Database backup
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Download the whole database — orders, challans, customers, accounts, users, everything — as
          one SQLite file. Safe to run while the app is in use. Keep a copy somewhere off this machine.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button onClick={download} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          {busy ? 'Preparing backup…' : 'Download backup'}
        </Button>
        <p className="text-muted-foreground text-xs">
          To restore: stop the server, replace{' '}
          <span className="font-mono">apps/api/prisma/dev.db</span> with the downloaded file, then
          start it again.
        </p>
      </CardContent>
    </Card>
  );
}
