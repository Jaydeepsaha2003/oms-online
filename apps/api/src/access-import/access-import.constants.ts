import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Private storage for the persisted .accdb — deliberately NOT under the
 * public /uploads directory, since this file can contain customer and
 * financial data and must never be reachable by URL.
 */
export const ACCESS_IMPORT_DIR = resolve(process.cwd(), '..', '..', 'data', 'access-import');
export const ACCESS_IMPORT_FILE_PATH = resolve(ACCESS_IMPORT_DIR, 'source.accdb');

export const APP_CONFIG_FILE_PATH_KEY = 'ACCESS_IMPORT_FILE_PATH';
export const APP_CONFIG_LAST_SYNC_KEY = 'ACCESS_IMPORT_LAST_SYNC';

/** Ensures the storage directory exists, returning its absolute path. */
export function ensureAccessImportDir(): string {
  if (!existsSync(ACCESS_IMPORT_DIR)) mkdirSync(ACCESS_IMPORT_DIR, { recursive: true });
  return ACCESS_IMPORT_DIR;
}
