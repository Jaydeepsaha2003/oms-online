import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
