import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What a restore did, for the confirmation shown afterwards. */
export interface RestoreResult {
  /** Where the database that was replaced has been kept. */
  safetyBackup: string;
  /** Byte size of the database now live. */
  size: number;
  /** Rows in a few well-known tables, so the user can see it is their data. */
  counts: { table: string; rows: number }[];
}

/** Every SQLite file starts with this, NUL included. */
const SQLITE_MAGIC = 'SQLite format 3\u0000';

/**
 * Tables that must be present for the upload to be this application's database
 * rather than some other SQLite file. Not a schema check — that is what the
 * migration comparison does — just a cheap way to reject an obvious mistake
 * before anything is touched.
 */
const CORE_TABLES = ['users', 'customers', 'challans', 'orders', '_prisma_migrations'];

/** Result of a `PRAGMA quick_check(1)` — SQLite's fast structural corruption scan. */
interface IntegrityResult {
  ok: boolean;
  /** "ok", or the problem(s) SQLite reported, joined for logging. */
  detail: string;
}

/** Result of taking a snapshot: an open stream plus the metadata for the download. */
export interface DatabaseBackup {
  stream: ReturnType<typeof createReadStream>;
  filename: string;
  /** Byte size of the snapshot, for the Content-Length header. */
  size: number;
}

/**
 * Whole-database export.
 *
 * Copying the live `dev.db` file byte-for-byte is unsafe: with WAL journalling
 * the newest committed pages may still live in `-wal`, so a plain copy can be
 * torn or miss recent writes. Instead we ask SQLite itself for a snapshot via
 * `VACUUM INTO`, which takes a read lock, writes a fully self-contained (and
 * incidentally defragmented) database to a new file, and needs no downtime.
 *
 * {@link snapshotTo} additionally guards against ever *saving* a bad backup:
 * it checks the live database's own integrity before touching anything, and
 * checks the freshly written snapshot's integrity before letting it replace
 * whatever backup already existed. Either check failing aborts the whole
 * operation with nothing on disk changed, so a corrupted source can never
 * overwrite the last known-good backup with garbage.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Snapshot the database into a temp file and return a stream over it. The temp
   * directory is removed once the stream closes (whether it finished or the
   * client aborted mid-download).
   */
  async createBackup(): Promise<DatabaseBackup> {
    const source = await this.resolveDatabaseFile();
    const dir = await mkdtemp(path.join(tmpdir(), 'oms-backup-'));
    const target = path.join(dir, 'snapshot.db');

    try {
      // VACUUM INTO requires the target not to exist — mkdtemp guarantees that.
      // SQLite accepts forward slashes on Windows; single-quotes are the string
      // delimiter, so a literal quote in the path must be doubled.
      await this.prisma.$executeRawUnsafe(
        `VACUUM INTO '${target.replace(/\\/g, '/').replace(/'/g, "''")}'`,
      );
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      this.logger.error(`Database snapshot failed: ${(error as Error).message}`);
      throw new InternalServerErrorException('Could not create a database backup.');
    }

    const { size } = await stat(target);
    const stream = createReadStream(target);
    const cleanup = () => {
      void rm(dir, { recursive: true, force: true }).catch((error: Error) =>
        this.logger.warn(`Could not remove temp backup dir ${dir}: ${error.message}`),
      );
    };
    stream.once('close', cleanup);
    stream.once('error', cleanup);

    this.logger.log(`Database backup created from ${source} (${size} bytes)`);
    return { stream, filename: this.filename(), size };
  }

  /**
   * Snapshot the database directly into `destPath`, overwriting whatever was
   * there before. Used by {@link AutoBackupScheduler}'s always-current local
   * copy, as opposed to {@link createBackup} which streams a one-off snapshot
   * out to an HTTP client.
   *
   * Validated on both ends — see the class doc — so a failure here always
   * means `destPath` is untouched, still holding the last good snapshot.
   */
  async snapshotTo(destPath: string): Promise<{ size: number }> {
    const source = await this.checkIntegrity(() => this.prisma.$queryRawUnsafe('PRAGMA quick_check(1)'));
    if (!source.ok) {
      throw new Error(`Source database failed its integrity check — skipping backup: ${source.detail}`);
    }

    await mkdir(path.dirname(destPath), { recursive: true });
    // VACUUM INTO refuses to write over an existing file, so snapshot next to
    // the target and swap it in — a reader (or the next tick, if this one is
    // still running when the interval fires again) never sees a half-written file.
    const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await this.prisma.$executeRawUnsafe(`VACUUM INTO '${tmp.replace(/\\/g, '/').replace(/'/g, "''")}'`);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }

    // A source that passes quick_check can still produce a bad copy (e.g. the
    // disk fills up mid-VACUUM) — check the actual output before it's allowed
    // to become the backup, not just the input.
    const snapshotClient = new PrismaClient({ datasources: { db: { url: 'file:' + tmp.replace(/\\/g, '/') } } });
    let snapshot: IntegrityResult;
    try {
      snapshot = await this.checkIntegrity(() => snapshotClient.$queryRawUnsafe('PRAGMA quick_check(1)'));
    } finally {
      await snapshotClient.$disconnect();
    }
    if (!snapshot.ok) {
      await rm(tmp, { force: true });
      throw new Error(`New snapshot failed its integrity check — discarded, previous backup kept: ${snapshot.detail}`);
    }

    await rename(tmp, destPath);
    return stat(destPath);
  }

  /**
   * Replace the live database with an uploaded backup.
   *
   * This throws away every row the application currently holds, so the order
   * below is deliberate: everything that can reject the file happens BEFORE the
   * live database is touched, and the database being replaced is kept rather
   * than deleted. A restore that turns out to be the wrong file is then another
   * restore, not a disaster.
   *
   *   1. is it a SQLite file at all, and does it pass its own integrity check;
   *   2. is it THIS application's database (the core tables are there);
   *   3. does its schema match the running code (same applied migrations) — an
   *      older backup would leave the server selecting columns that do not
   *      exist, failing at the first page load rather than here;
   *   4. only now: snapshot what is live, swap the file in, reconnect;
   *   5. prove the new database answers a query before reporting success.
   */
  async restoreFrom(upload: Buffer, originalName: string): Promise<RestoreResult> {
    if (upload.length === 0) throw new BadRequestException('That file is empty.');
    if (upload.subarray(0, 16).toString('latin1') !== SQLITE_MAGIC) {
      throw new BadRequestException(
        `"${originalName}" is not a SQLite database. Upload the .db file that Download backup produced.`,
      );
    }

    const live = await this.resolveDatabaseFile();
    const dir = await mkdtemp(path.join(tmpdir(), 'oms-restore-'));
    const incoming = path.join(dir, 'incoming.db');

    try {
      await writeFile(incoming, upload);
      await this.vetIncoming(incoming, originalName);

      // Everything below this line changes the live database.
      const stamp = this.stamp();
      const safetyBackup = path.join(await this.projectBackupDir(), `pre-restore-${stamp}.db`);
      await this.snapshotTo(safetyBackup);
      this.logger.warn(`Restore requested — the database being replaced is saved at ${safetyBackup}`);

      await this.swapIn(incoming, live, stamp);

      const counts = await this.sampleCounts();
      const { size } = await stat(live);
      this.logger.warn(`Database restored from "${originalName}" (${size} bytes)`);
      return { safetyBackup, size, counts };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Everything that can say no, said before the live database is touched.
   *
   * Runs against the uploaded copy through its own client, disconnected either
   * way — on Windows a client still holding that file would stop it being
   * copied into place a moment later.
   */
  private async vetIncoming(file: string, originalName: string): Promise<void> {
    const client = new PrismaClient({ datasources: { db: { url: 'file:' + file.replace(/\\/g, '/') } } });
    try {
      const health = await this.checkIntegrity(() => client.$queryRawUnsafe('PRAGMA quick_check(1)'));
      if (!health.ok) {
        throw new BadRequestException(`"${originalName}" is damaged and was not restored: ${health.detail}`);
      }

      const tables = new Set(
        (
          await client.$queryRawUnsafe<{ name: string }[]>(
            "SELECT name FROM sqlite_master WHERE type = 'table'",
          )
        ).map((r) => r.name),
      );
      const missing = CORE_TABLES.filter((t) => !tables.has(t));
      if (missing.length) {
        throw new BadRequestException(
          `"${originalName}" does not look like an OMS backup — it has no ${missing.join(', ')} table.`,
        );
      }

      /*
       * The schema has to match the code that is about to query it.
       *
       * A backup taken before a migration is missing the columns the running
       * server now selects, so it would restore cleanly and then fail on the
       * first page load — the worst moment to find out. Comparing the applied
       * migrations catches it here, and says what to do about it.
       */
      const applied = async (c: { $queryRawUnsafe: PrismaClient['$queryRawUnsafe'] }) =>
        new Set(
          (
            await c.$queryRawUnsafe<{ migration_name: string }[]>(
              'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL',
            )
          ).map((r) => r.migration_name),
        );
      const inFile = await applied(client);
      const inLive = await applied(this.prisma);
      const older = [...inLive].filter((m) => !inFile.has(m)).sort();
      const newer = [...inFile].filter((m) => !inLive.has(m)).sort();
      if (older.length) {
        throw new BadRequestException(
          `"${originalName}" predates ${older.length} database change(s) this version needs (earliest: ${older[0]}). ` +
            `Restoring it would break the app. Use a newer backup, or roll the code back to match it.`,
        );
      }
      if (newer.length) {
        throw new BadRequestException(
          `"${originalName}" comes from a NEWER version of the app — ${newer.length} change(s) this server does not have ` +
            `(e.g. ${newer[0]}). Update this server first, then restore.`,
        );
      }
    } finally {
      await client.$disconnect();
    }
  }

  /**
   * Put the vetted file in place.
   *
   * Prisma has the live database open and on Windows an open file cannot be
   * replaced, so the client is disconnected first and reconnected after. The
   * database being replaced is renamed rather than deleted, and the `-wal` /
   * `-shm` sidecars are removed with it: left behind they belong to the OLD
   * database and SQLite would try to replay them over the new one.
   *
   * If anything fails mid-swap the original is put back before rethrowing, so a
   * failed restore leaves the server exactly as it was.
   */
  private async swapIn(incoming: string, live: string, stamp: string): Promise<void> {
    const replaced = `${live}.replaced-${stamp}`;
    await this.prisma.$disconnect();
    let moved = false;
    try {
      await rename(live, replaced);
      moved = true;
      await copyFile(incoming, live);
      await rm(`${live}-wal`, { force: true });
      await rm(`${live}-shm`, { force: true });
    } catch (error) {
      if (moved) await rename(replaced, live).catch(() => undefined);
      await this.prisma.$connect().catch(() => undefined);
      this.logger.error(`Restore failed while swapping the file: ${(error as Error).message}`);
      throw new InternalServerErrorException(
        'The database could not be replaced, and nothing was changed. It is most likely still in use — try again in a moment.',
      );
    }

    await this.prisma.$connect();
    // Prove the new file answers before anyone is told it worked.
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    } catch (error) {
      this.logger.error(`Restored database does not respond: ${(error as Error).message}`);
      throw new InternalServerErrorException(
        `The restored database did not respond. The previous one is at ${replaced}.`,
      );
    }
    this.logger.warn(`Previous database kept at ${replaced}`);
  }

  /** A few row counts, so the confirmation can show it really is their data. */
  private async sampleCounts(): Promise<{ table: string; rows: number }[]> {
    const out: { table: string; rows: number }[] = [];
    for (const table of ['customers', 'orders', 'challans', 'users']) {
      try {
        const rows = await this.prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
          `SELECT COUNT(*) AS n FROM ${table}`,
        );
        out.push({ table, rows: Number(rows[0]?.n ?? 0) });
      } catch {
        // A table this schema does not have is simply not reported.
      }
    }
    return out;
  }

  /** `2026-08-29-2143` — sorts chronologically, safe in a filename. */
  private stamp(): string {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
      `-${p(now.getHours())}${p(now.getMinutes())}`
    );
  }

  /** Runs `PRAGMA quick_check(1)` (fast structural scan, not the exhaustive
   *  `integrity_check`, and capped to the first problem found — a genuinely
   *  corrupted database can otherwise report hundreds of lines, and one line
   *  every 5 minutes is plenty to know something is wrong) via the given
   *  query function and interprets the result. */
  private async checkIntegrity(query: () => Promise<unknown>): Promise<IntegrityResult> {
    const rows = (await query()) as { quick_check: string }[];
    const ok = rows.length === 1 && rows[0].quick_check === 'ok';
    return { ok, detail: ok ? 'ok' : rows.map((r) => r.quick_check).join('; ') };
  }

  /**
   * Where the in-app auto-backup writes its rolling snapshot: a `backups/`
   * folder at the repo root — the same folder `scripts/backup-db.cjs` already
   * uses for the nightly archived copies (and that's `.gitignore`d for it).
   * Derived from the live database path (3 levels up from `apps/api/prisma/`)
   * rather than `process.cwd()`, which varies with how the API was launched.
   */
  async projectBackupDir(): Promise<string> {
    const dbFile = await this.resolveDatabaseFile();
    return path.resolve(path.dirname(dbFile), '..', '..', '..', 'backups');
  }

  /**
   * Ask SQLite where the `main` database lives rather than re-deriving it from
   * DATABASE_URL — Prisma resolves relative SQLite paths against the schema
   * directory, and duplicating that rule here would be easy to get wrong.
   */
  private async resolveDatabaseFile(): Promise<string> {
    const rows =
      await this.prisma.$queryRawUnsafe<{ name: string; file: string | null }[]>(
        'PRAGMA database_list',
      );
    const file = rows.find((r) => r.name === 'main')?.file;
    if (!file) {
      // An in-memory database has an empty `file` — nothing to hand out.
      throw new InternalServerErrorException('This deployment has no file-backed database to back up.');
    }
    return file;
  }

  /** e.g. `oms-backup-2026-07-31-2243.db` — sorts chronologically by name. */
  private filename(): string {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
      `-${p(now.getHours())}${p(now.getMinutes())}`;
    return `oms-backup-${stamp}.db`;
  }
}
