import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { BackupService } from './backup.service';

const INTERVAL_MS = 5 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** How many past weekly snapshots to keep (~3 months) before pruning the oldest. */
const RETAIN_WEEKS = 12;
const FILE_PREFIX = 'oms-weekly-backup-';
const FILE_RE = /^oms-weekly-backup-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * Keeps a database snapshot in `<repo root>/backups/`, refreshed every 5
 * minutes so it's never more than 5 minutes stale, and rotated onto a fresh
 * file every 7 days so each week's state is frozen rather than continuously
 * overwritten forever — a corrupted week doesn't erase the previous one.
 *
 * The 7-day window is a fixed bucket from the Unix epoch
 * (`floor(now / 7 days) * 7 days`), not a marker file the app has to
 * remember across restarts — the same wall-clock instant always maps to the
 * same filename, so there's no drift or "which week was I on" state to lose.
 * Every tick inside one 7-day bucket lands on that bucket's file; the moment
 * the bucket advances, the computed filename changes and a fresh snapshot
 * starts there, leaving the previous week's file untouched as an archive.
 *
 * Every snapshot is integrity-checked before it's allowed to replace
 * anything (see {@link BackupService.snapshotTo}) — a corrupted live database
 * is skipped outright, and a bad write is discarded — so a failure here
 * never costs the last known-good backup, it just leaves it as-is.
 */
@Injectable()
export class AutoBackupScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutoBackupScheduler.name);

  constructor(private readonly backup: BackupService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.run();
  }

  @Interval(INTERVAL_MS)
  async run(): Promise<void> {
    // @nestjs/schedule drives this off setInterval, which does not catch
    // rejections — an uncaught one here would crash the whole process on a
    // transient failure (corruption, disk full, SQLite busy) instead of just
    // skipping this tick and trying again in 5 minutes.
    try {
      const dir = await this.backup.projectBackupDir();
      const dest = path.join(dir, this.currentWeekFilename());
      const { size } = await this.backup.snapshotTo(dest);
      this.logger.log(`Auto backup refreshed: ${dest} (${size} bytes)`);
      await this.pruneOldWeeks(dir);
    } catch (error) {
      this.logger.warn(`Auto backup skipped this cycle: ${(error as Error).message}`);
    }
  }

  /** e.g. `oms-weekly-backup-2026-08-02.db` — the same name for every tick
   *  inside one fixed 7-day bucket; changes the moment the bucket rolls over. */
  private currentWeekFilename(): string {
    const weekStart = new Date(Math.floor(Date.now() / WEEK_MS) * WEEK_MS);
    const p = (n: number) => String(n).padStart(2, '0');
    const ymd = `${weekStart.getFullYear()}-${p(weekStart.getMonth() + 1)}-${p(weekStart.getDate())}`;
    return `${FILE_PREFIX}${ymd}.db`;
  }

  /** Keeps the newest {@link RETAIN_WEEKS} weekly files, deleting older ones —
   *  otherwise a permanently-running app accumulates one ~6MB+ file a week forever. */
  private async pruneOldWeeks(dir: string): Promise<void> {
    const entries = await readdir(dir).catch(() => [] as string[]);
    const weekly = entries.filter((f) => FILE_RE.test(f)).sort(); // yyyy-mm-dd names sort chronologically
    const stale = weekly.slice(0, Math.max(0, weekly.length - RETAIN_WEEKS));
    for (const f of stale) {
      await rm(path.join(dir, f), { force: true }).catch((error: Error) =>
        this.logger.warn(`Could not prune old auto backup ${f}: ${error.message}`),
      );
    }
  }
}
