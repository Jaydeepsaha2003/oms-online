/**
 * Embeddable fonts for jsPDF documents.
 *
 * jsPDF only ships the PDF base-14 faces (Helvetica/Times/Courier); anything
 * else has to be embedded as a raw TTF through its virtual file system.
 *
 * CARLITO is used wherever a document calls for Calibri. It's Google's
 * metric-compatible Calibri substitute — identical advance widths, near-identical
 * shapes — under the SIL Open Font License, so unlike Calibri itself it can be
 * shipped with the app and embedded in customer-facing PDFs without a licence
 * question. The .ttf assets are generated from @fontsource/carlito by
 * `scripts/woff-to-ttf.cjs`.
 */
import type { jsPDF } from 'jspdf';
import carlitoRegular from '@/assets/fonts/carlito-regular.ttf';
import carlitoBold from '@/assets/fonts/carlito-bold.ttf';

/** The family name to pass to `doc.setFont()` once {@link registerCalibriFont} resolves. */
export const CALIBRI_FONT = 'Carlito';

/** Fetch a font asset and base64 it (what jsPDF's VFS expects). Cached — the
 *  bytes are identical for every document. */
const cache = new Map<string, Promise<string>>();
function loadBase64(url: string): Promise<string> {
  let hit = cache.get(url);
  if (!hit) {
    hit = (async () => {
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
      return btoa(bin);
    })();
    cache.set(url, hit);
  }
  return hit;
}

/**
 * Register Carlito (regular + bold) on `doc` so `setFont(CALIBRI_FONT, 'bold')`
 * works. Returns false if the fonts couldn't be loaded, letting the caller fall
 * back to Helvetica rather than producing a broken document.
 */
export async function registerCalibriFont(doc: jsPDF): Promise<boolean> {
  try {
    const [regular, bold] = await Promise.all([loadBase64(carlitoRegular), loadBase64(carlitoBold)]);
    doc.addFileToVFS('Carlito-Regular.ttf', regular);
    doc.addFont('Carlito-Regular.ttf', CALIBRI_FONT, 'normal');
    doc.addFileToVFS('Carlito-Bold.ttf', bold);
    doc.addFont('Carlito-Bold.ttf', CALIBRI_FONT, 'bold');
    return true;
  } catch {
    return false;
  }
}
