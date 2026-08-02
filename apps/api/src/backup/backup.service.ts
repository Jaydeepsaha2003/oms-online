import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
