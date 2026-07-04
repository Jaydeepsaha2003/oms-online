/*
 * OMS database backup.
 * Copies the SQLite database file(s) into ../backups/ with a timestamped name,
 * then prunes to the most recent KEEP copies. All your data lives in this one
 * file, so an automatic daily copy is your safety net against disk failure or
 * mistakes. Run it via backup-db.cmd (and schedule that daily).
 *
 * Tip: SQLite is safest to copy when the app is idle, so the scheduled task is
 * set for late evening by default.
 */
const fs = require('fs');
const path = require('path');

const KEEP = 30; // keep the newest 30 daily backups
const srcDir = path.join(__dirname, '..', 'apps', 'api', 'prisma');
const destDir = path.join(__dirname, '..', 'backups');

fs.mkdirSync(destDir, { recursive: true });

const stamp = new Date().toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 19);
let copied = 0;
for (const f of ['dev.db', 'dev.db-wal', 'dev.db-shm']) {
  const src = path.join(srcDir, f);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(destDir, f.replace('dev.db', `dev-${stamp}.db`));
  fs.copyFileSync(src, dest);
  copied++;
}

// Prune old backups (keep the newest KEEP by the main .db file's timestamp).
const mains = fs
  .readdirSync(destDir)
  .filter((f) => /^dev-.*\.db$/.test(f))
  .map((f) => ({ f, t: fs.statSync(path.join(destDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
for (const old of mains.slice(KEEP)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = path.join(destDir, old.f + suffix);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

console.log(`[OMS backup] ${copied} file(s) saved as dev-${stamp}.db  (keeping newest ${KEEP}; ${mains.length} total)`);
