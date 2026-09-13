import { existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import sharp from 'sharp';
import { DESIGN_NAME_PHOTOS_SUBDIR, ORDER_ITEM_PHOTOS_SUBDIR, UPLOADS_DIR, UPLOADS_URL_PREFIX } from './uploads.constants';

/**
 * Small JPEG thumbnails of uploaded photos, for grids.
 *
 * Photos are stored as the phone took them — 470 KB on average, 2.5 MB at worst
 * — and the Product Photos gallery used to paint each one into a ~110 px
 * square. A single screen then pulled tens of MB, which over the office VPN
 * choked the link until even the live-connection dot dropped to red. A 360 px
 * thumbnail is a few dozen KB and still sharp at 3x on a phone.
 *
 * GET /api/uploads/thumbs/<subdir>/<file> — generated on first request, then
 * served from UPLOADS_DIR/.thumbs (a dot-folder, which the static handler
 * never exposes directly). Upload filenames are UUIDs that never change
 * content, so a thumbnail can be cached for good.
 */
export const THUMBS_URL_PREFIX = `${UPLOADS_URL_PREFIX}/thumbs`;
const THUMB_WIDTH = 360;
const SUBDIRS = new Set([ORDER_ITEM_PHOTOS_SUBDIR, DESIGN_NAME_PHOTOS_SUBDIR]);
// One path segment of UUID-ish name and an image extension — nothing else,
// so no `..` or separator can ever reach the filesystem join below.
const FILE_RE = /^[\w-]+\.(jpe?g|png|webp)$/i;

export async function serveThumbnail(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const [, subdir, file, extra] = req.path.split('/');
  if (extra !== undefined || !SUBDIRS.has(subdir) || !FILE_RE.test(file ?? '')) {
    res.status(404).end();
    return;
  }
  const original = join(UPLOADS_DIR, subdir, file);
  if (!existsSync(original)) {
    res.status(404).end();
    return;
  }

  const cacheDir = join(UPLOADS_DIR, '.thumbs', subdir);
  const thumb = join(cacheDir, `${file}.jpg`);
  try {
    if (!existsSync(thumb)) {
      await mkdir(cacheDir, { recursive: true });
      // Write beside, then rename: two phones opening the gallery at once both
      // generate, and neither can serve the other a half-written file.
      const tmp = `${thumb}.${process.pid}.${Date.now()}.tmp`;
      await sharp(original)
        .rotate() // honour the EXIF orientation phones write, or portrait shots show sideways
        .resize({ width: THUMB_WIDTH, height: THUMB_WIDTH, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 72, mozjpeg: true })
        .toFile(tmp);
      await rename(tmp, thumb);
    }
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    // `dotfiles: 'allow'` — the cache lives in `.thumbs`, and sendFile otherwise
    // refuses any path with a dot-folder in it. The path is built above from a
    // validated name, so this exposes nothing a request could choose.
    res.type('image/jpeg').sendFile(thumb, { dotfiles: 'allow' });
  } catch {
    // A file sharp cannot read still gets a picture — the full-size original.
    res.redirect(302, `${UPLOADS_URL_PREFIX}/${subdir}/${file}`);
  }
}
