import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Filesystem + URL layout for user-uploaded files.
 *
 * Files live in a `/uploads` folder at the project root (a sibling of `apps/`).
 * The API always runs with its cwd at `apps/api` (both `npm run dev -w @oms/api`
 * and the packaged single-port server), so the root is two levels up. Override
 * with the UPLOADS_DIR env var if the files should live elsewhere.
 *
 * Only the *path* (relative to this root) and the served URL are stored in the
 * DB — never the raw bytes.
 */
export const UPLOADS_DIR = (() => {
  const fromEnv = process.env.UPLOADS_DIR;
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(process.cwd(), fromEnv);
  return resolve(process.cwd(), '..', '..', 'uploads');
})();

/** Sub-folder (under UPLOADS_DIR) for order-line photos. */
export const ORDER_ITEM_PHOTOS_SUBDIR = 'order-items';

/** URL prefix the web app loads uploads from. Sits under `/api` so the Vite dev
 *  proxy (and the single-port prod server) route it to this API unchanged. */
export const UPLOADS_URL_PREFIX = '/api/uploads';

/** Ensure a directory under UPLOADS_DIR exists, returning its absolute path. */
export function ensureUploadDir(subdir = ''): string {
  const dir = subdir ? join(UPLOADS_DIR, subdir) : UPLOADS_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
