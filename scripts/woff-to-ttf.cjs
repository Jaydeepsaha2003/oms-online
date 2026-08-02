/**
 * WOFF (v1) → TTF converter.
 *
 * jsPDF embeds raw SFNT fonts (.ttf/.otf), but @fontsource ships only
 * .woff/.woff2. WOFF v1 is simply an SFNT whose tables are individually
 * zlib-deflated, so unwrapping it back to a TTF is exact and lossless — no
 * rasterising, no re-hinting. (WOFF2 is Brotli + glyph transforms and is NOT
 * handled here; we deliberately read the .woff.)
 *
 * Run once to (re)generate the committed PDF font assets:
 *   node scripts/woff-to-ttf.cjs
 *
 * Spec: https://www.w3.org/TR/WOFF/
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/** Unwrap one WOFF buffer into an equivalent TTF buffer. */
function woffToTtf(woff) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('not a WOFF v1 file');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);

  // Table directory: tag, offset, compLength, origLength, origChecksum.
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = woff.toString('ascii', o, o + 4);
    const offset = woff.readUInt32BE(o + 4);
    const compLength = woff.readUInt32BE(o + 8);
    const origLength = woff.readUInt32BE(o + 12);
    const checksum = woff.readUInt32BE(o + 16);
    const raw = woff.subarray(offset, offset + compLength);
    // compLength === origLength means the table was stored uncompressed.
    const data = compLength < origLength ? zlib.inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error(`${tag}: expected ${origLength} bytes, got ${data.length}`);
    tables.push({ tag, checksum, data });
  }
  // An SFNT table directory must be sorted by tag.
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const pad4 = (n) => (n + 3) & ~3;
  const headerSize = 12 + numTables * 16;
  const total = tables.reduce((sum, t) => sum + pad4(t.data.length), headerSize);
  const out = Buffer.alloc(total);

  // SFNT header — searchRange/entrySelector/rangeShift are derived from numTables.
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);

  let dir = 12;
  let dataAt = headerSize;
  for (const t of tables) {
    out.write(t.tag, dir, 4, 'ascii');
    out.writeUInt32BE(t.checksum, dir + 4);
    out.writeUInt32BE(dataAt, dir + 8);
    out.writeUInt32BE(t.data.length, dir + 12);
    dir += 16;
    t.data.copy(out, dataAt);
    dataAt += pad4(t.data.length); // Buffer.alloc already zero-filled the padding.
  }
  return out;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const src = path.join(root, 'node_modules', '@fontsource', 'carlito', 'files');
  const destDir = path.join(root, 'apps', 'web', 'src', 'assets', 'fonts');
  fs.mkdirSync(destDir, { recursive: true });

  // Latin subset only — the rate list is English/numeric, and the full family
  // would bloat every generated PDF.
  for (const [from, to] of [
    ['carlito-latin-400-normal.woff', 'carlito-regular.ttf'],
    ['carlito-latin-700-normal.woff', 'carlito-bold.ttf'],
  ]) {
    const ttf = woffToTtf(fs.readFileSync(path.join(src, from)));
    fs.writeFileSync(path.join(destDir, to), ttf);
    console.log(`${from} → ${to}  (${(ttf.length / 1024).toFixed(0)} KB)`);
  }
  // Ship the licence alongside the fonts (Carlito is SIL OFL 1.1).
  fs.copyFileSync(path.join(root, 'node_modules', '@fontsource', 'carlito', 'LICENSE'), path.join(destDir, 'Carlito-LICENSE.txt'));
  console.log('LICENSE → Carlito-LICENSE.txt');
}

module.exports = { woffToTtf };
