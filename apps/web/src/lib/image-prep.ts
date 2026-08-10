/**
 * Make a camera/gallery photo uploadable.
 *
 * Written for Android, where picking a photo failed outright in three ways:
 *
 *  1. Android pickers (Google Photos, Drive, several OEM galleries, anything
 *     behind the Storage Access Framework) routinely hand back a `File` whose
 *     `type` is an EMPTY STRING. Any `type.startsWith('image/')` guard rejects
 *     those, so the picker appeared to do nothing — see {@link looksLikeImage}.
 *  2. Phone cameras produce 8-15 MB JPEGs, over both the client and server 8 MB
 *     caps, so a perfectly good photo was refused for being too big.
 *  3. Uploading 12 MP originals over cellular is slow enough to look broken.
 *
 * These are REFERENCE photos — the job is recognising a design, not archival
 * fidelity — so shrinking the longest edge to {@link MAX_EDGE} and re-encoding
 * as JPEG fixes (2) and (3) properly instead of just raising a limit. Small
 * files pass through untouched.
 *
 * EXIF orientation is honoured via `createImageBitmap(..., { imageOrientation:
 * 'from-image' })`; without it a canvas redraw silently drops the rotation flag
 * and portrait phone photos come out sideways.
 */

/** Longest edge after downscaling. ~1600px still reads clearly full-screen in
 *  the lightbox while cutting a 12 MP original to a few hundred KB. */
const MAX_EDGE = 1600;
/** Below this, re-encoding costs quality for no real saving — pass it through. */
const PASSTHROUGH_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.82;

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'jfif', 'avif'];

/**
 * Is this plausibly an image? Prefers the MIME type, and falls back to the
 * filename extension when the type is missing — which is the normal case for
 * Android's own pickers, not an edge case.
 */
export function looksLikeImage(file: File): boolean {
  if (file.type) return file.type.startsWith('image/');
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.includes(ext);
}

/** Swap the extension for .jpg once a file has been re-encoded. */
function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'photo';
  return `${base}.jpg`;
}

/**
 * Downscale + re-encode when needed, else return the file unchanged. Never
 * throws: if the browser can't decode the format (an HEIC on a browser without
 * HEIC support, say) the original file is returned so the server still gets its
 * chance to accept or reject it with a real message.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  // A small file that already declares a web-safe type needs nothing done.
  if (file.size <= PASSTHROUGH_BYTES && file.type && file.type !== 'image/heic' && file.type !== 'image/heif') {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small enough AND under the passthrough size: nothing to gain.
    if (scale === 1 && file.size <= PASSTHROUGH_BYTES) {
      bitmap.close();
      return file;
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return file;
    // Keep the original if re-encoding somehow made it bigger (tiny PNGs can).
    if (blob.size >= file.size && file.type) return file;
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
