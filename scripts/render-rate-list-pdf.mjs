/**
 * Rate List PDF design harness.
 *
 * Renders `buildRateListPdfDoc()` — the SAME function the app ships — to a real
 * .pdf (and .png previews) so the document can be reviewed visually while it's
 * being designed, instead of shipping a print artefact sight-unseen.
 *
 *   node scripts/render-rate-list-pdf.mjs [outDir]
 *
 * How it works: esbuild bundles the browser-side exporter for Node, with two
 * small shims — the PNG import becomes a data: URL (so the watermark loads
 * without a bundler/DOM), and the `@/…` path alias is resolved to apps/web/src.
 * Sample data below mirrors the real CustomerRateList shape.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = path.join(root, 'apps', 'web', 'src');
const outDir = path.resolve(process.argv[2] ?? path.join(root, '.design-preview'));
mkdirSync(outDir, { recursive: true });

const ASSET_RE = /\.(png|jpe?g|svg|ttf|otf|woff2?)$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
/** Resolve an extensionless import the way the bundler would (.ts/.tsx/…). */
const withExt = (p) => {
  if (path.extname(p)) return p;
  for (const e of ['.ts', '.tsx', '.js', '.jsx', '.mjs']) if (existsSync(p + e)) return p + e;
  for (const e of ['.ts', '.tsx', '.js', '.jsx']) {
    const idx = path.join(p, `index${e}`);
    if (existsSync(idx)) return idx;
  }
  return p;
};

/** Inline images as data: URLs and map the `@/` alias to apps/web/src. */
const shim = {
  name: 'harness-shim',
  setup(build) {
    // `@/lib/pdf` holds the browser SAVE helpers (and pulls in axios via the API
    // client). Document construction never touches them, so stub it out rather
    // than bundling a browser HTTP stack into a CLI renderer.
    build.onResolve({ filter: /^@\/lib\/pdf$/ }, () => ({ path: 'lib-pdf', namespace: 'stub' }));
    build.onLoad({ filter: /^lib-pdf$/, namespace: 'stub' }, () => ({
      contents: 'export const preOpenPdfTab = () => null; export const savePdfBlob = async () => {};',
      loader: 'js',
    }));
    build.onResolve({ filter: /^@\// }, (a) => {
      const p = path.join(webSrc, a.path.slice(2));
      // Assets keep going to the data-URL loader below; code gets an extension.
      return ASSET_RE.test(p) ? { path: p, namespace: 'asset' } : { path: withExt(p) };
    });
    build.onResolve({ filter: ASSET_RE }, (a) => ({
      path: path.resolve(a.resolveDir, a.path),
      namespace: 'asset',
    }));
    build.onLoad({ filter: /.*/, namespace: 'asset' }, (a) => {
      const ext = path.extname(a.path).slice(1).toLowerCase();
      const b64 = readFileSync(a.path).toString('base64');
      return { contents: `export default "data:${MIME[ext] ?? 'application/octet-stream'};base64,${b64}"`, loader: 'js' };
    });
  },
};

const bundle = path.join(outDir, '_bundle.mjs');
await esbuild.build({
  entryPoints: [path.join(webSrc, 'features', 'customers', 'customer-rate-list-export.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  plugins: [shim],
  logLevel: 'error',
  // Only the Excel exporter (same module) needs xlsx, and its CJS build does a
  // dynamic require() that can't be bundled to ESM — let Node resolve it.
  external: ['xlsx'],
  // The exporter's save path touches browser globals; the harness only calls
  // buildRateListPdfDoc, so stubbing these keeps the import side-effect free.
  // jsPDF's Node build also reads atob/btoa off the same object.
  banner: {
    js: 'globalThis.window ??= globalThis; globalThis.window.open ??= () => null;'
      + ' globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");'
      + ' globalThis.btoa ??= (s) => Buffer.from(s, "binary").toString("base64");',
  },
});

/* ── Sample data: shaped exactly like the API's CustomerRateList ─────────── */
const P = (category, subCategory, product, pcs, rate, delta = 0) => ({
  category, subCategory, product, size: null, pcs, weight: null,
  baseRate: rate - delta, delta, rate, from: delta ? 'ITEM' : null,
});
const D = (category, subCategory, designType, rate, delta = 0) => ({
  category, subCategory, designType, baseRate: rate - delta, delta, rate, from: delta ? 'CATEGORY' : null,
});

const list = {
  customerId: 1,
  customerName: 'KEERTHIKA STAINLESS STEEL TRADERS',
  generatedAt: new Date().toISOString(),
  products: [
    P('DINNER SET', '8-PCS', 'RAJWADI', 8, 415), P('DINNER SET', '10-PCS', 'RAJWADI', 10, 415),
    P('DINNER SET', '12-PCS', 'RAJWADI', 12, 432), P('DINNER SET', '15-PCS', 'RAJWADI', 15, 448),
    P('DINNER SET', '8-PCS', 'MONALISA', 8, 505, 15), P('DINNER SET', '10-PCS', 'MONALISA', 10, 505, 15),
    P('DINNER SET', '12-PCS', 'MONALISA', 12, 524, 15), P('DINNER SET', '8-PCS', 'PARASUT', 8, 388),
    P('DINNER SET', '12-PCS', 'PARASUT', 12, 401), P('DINNER SET', '6-PCS', 'PARASUT', 6, 372),
    P('DINNER SET', '8-PCS', 'JET DELUXE', 8, 610), P('DINNER SET', '12-PCS', 'JET DELUXE', 12, 638),
    P('DINNER SET', '15-PCS', 'JET DELUXE', 15, 664), P('DINNER SET', '8-PCS', 'AJUBA', 8, 455),
    P('DINNER SET', '12-PCS', 'AJUBA', 12, 470), P('DINNER SET', '8-PCS', 'FLOWER POT', 8, 342),
    P('DINNER SET', '12-PCS', 'FLOWER POT', 12, 356), P('DINNER SET', '8-PCS', 'BOROSIL SPECIAL', 8, 720, -20),
    P('DINNER SET', '12-PCS', 'BOROSIL SPECIAL', 12, 748, -20),
    P('CUP', '6-PCS', 'MALBORO CUP', 6, 128), P('CUP', '12-PCS', 'MALBORO CUP', 12, 132),
    P('CUP', '6-PCS', 'FROOTY CUP', 6, 141), P('CUP', '12-PCS', 'FROOTY CUP', 12, 145),
    P('CUP', '6-PCS', 'BREZZA CUP', 6, 155, 8), P('CUP', '12-PCS', 'BREZZA CUP', 12, 160, 8),
    P('CUP', '6-PCS', 'ROYAL CUP', 6, 174), P('CUP', '12-PCS', 'ROYAL CUP', 12, 179),
    P('SCRAP', '', 'S.S. SCRAP', null, 96),
  ],
  designs: [
    D('GLASS', '8-PCS', 'LASER', 42), D('GLASS', '12-PCS', 'LASER', 46),
    D('GLASS', '8-PCS', 'WL+TOOL+LOGO', 68, 6), D('GLASS', '12-PCS', 'WL+TOOL+LOGO', 73, 6),
    D('GLASS', '8-PCS', 'DIAMOND HAMMER', 88), D('GLASS', '12-PCS', 'DIAMOND HAMMER', 94),
    D('GLASS', '8-PCS', 'FULL LASER+DL', 112), D('GLASS', '12-PCS', 'FULL LASER+DL', 120),
    D('GLASS', '8-PCS', 'PVD+LOGO', 145), D('GLASS', '12-PCS', 'PVD+LOGO', 152),
  ],
};

// `--big` inflates the catalogue so the multi-page path (continuation header,
// repeated table headers, page x of y) actually gets exercised.
if (process.argv.includes('--big')) {
  const extra = [];
  for (let i = 1; i <= 4; i++) {
    for (const p of list.products) {
      extra.push({ ...p, category: `${p.category} SERIES ${i}`, product: `${p.product} MK${i}` });
    }
  }
  list.products = [...list.products, ...extra];
}

// `--long-name` stress-tests the header/footer with a customer name far longer
// than typical, so overlaps show up before a customer ever sees them.
if (process.argv.includes('--long-name')) {
  list.customerName = 'SHREE MAHALAKSHMI STAINLESS STEEL TRADING & DISTRIBUTION COMPANY PRIVATE LIMITED';
}

const { buildRateListPdfDoc } = await import(pathToFileURL(bundle).href);
const doc = await buildRateListPdfDoc(list);
const pdfPath = path.join(outDir, 'rate-list.pdf');
writeFileSync(pdfPath, Buffer.from(doc.output('arraybuffer')));
console.log(`PDF   → ${pdfPath}  (${doc.getNumberOfPages()} page(s))`);

/* Rasterise each page to PNG for eyes-on review (pdf.js + napi canvas — no
 * poppler/ImageMagick needed, so this works on a stock Windows box too). */
const { createCanvas } = await import('@napi-rs/canvas');
// The bundle's browser shim leaves a `window` on globalThis, so pdf.js takes its
// browser code path — give it the one DOM API that path needs.
globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.window.requestAnimationFrame ??= globalThis.requestAnimationFrame;
// pdf.js fetches its standard-font data by URL, and Node's fetch refuses
// file://. Without this the preview silently substitutes a fallback face and
// mis-renders letter-spacing — i.e. it would lie about the design.
const nodeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url.startsWith('file://')) {
    const body = readFileSync(fileURLToPath(url));
    return new Response(body, { status: 200 });
  }
  return nodeFetch(input, init);
};
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const task = pdfjs.getDocument({
  data: new Uint8Array(doc.output('arraybuffer')),
  disableFontFace: true,
  // Helvetica & friends aren't embedded by jsPDF — point pdf.js at its shipped
  // standard-font data so the preview renders real glyphs, not blanks.
  standardFontDataUrl: pathToFileURL(path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep).href,
});
const rendering = await task.promise;
/* Layout audit: pull the real text runs (position + measured width) out of the
 * finished PDF and flag any two on the same baseline that overlap, or anything
 * spilling past the page margins. Catches long-customer-name collisions in the
 * masthead/footer that a screenshot at one sample size would miss. */
const auditPage = async (page, pageNo) => {
  const { items } = await page.getTextContent();
  const runs = items
    .filter((it) => it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: Math.round(it.transform[5] * 2) / 2, w: it.width }));
  const problems = [];
  const W = page.getViewport({ scale: 1 }).width;
  // jsPDF emits base-14 Helvetica (not embedded). pdf.js has no Helvetica here,
  // so it substitutes a slightly WIDER face and every extracted width comes back
  // a few percent high. Allow that much slack, else shrink-to-fit text that
  // actually lands exactly on the margin reads as a spill.
  const SLACK = 0.04;
  for (const r of runs) {
    if (r.x < 30 || r.x + r.w / (1 + SLACK) > W - 30) {
      problems.push(`p${pageNo} margin spill: "${r.str}" (x=${r.x.toFixed(0)} w=${r.w.toFixed(0)})`);
    }
  }
  const byLine = new Map();
  for (const r of runs) (byLine.get(r.y) ?? byLine.set(r.y, []).get(r.y)).push(r);
  for (const line of byLine.values()) {
    line.sort((a, b) => a.x - b.x);
    for (let i = 0; i < line.length - 1; i++) {
      // 0.5pt slack absorbs rounding in the extracted glyph widths.
      if (line[i].x + line[i].w > line[i + 1].x + 0.5) {
        problems.push(`p${pageNo} overlap: "${line[i].str}" ⟂ "${line[i + 1].str}"`);
      }
    }
  }
  return problems;
};

const allProblems = [];
for (let i = 1; i <= rendering.numPages; i++) {
  const page = await rendering.getPage(i);
  allProblems.push(...(await auditPage(page, i)));
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  // PDF pages are transparent by default — paint the paper white so the preview
  // shows what actually prints.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const png = path.join(outDir, `page-${i}.png`);
  writeFileSync(png, canvas.toBuffer('image/png'));
  console.log(`PNG   → ${png}`);
}

if (allProblems.length) {
  console.log(`\nAUDIT → ${allProblems.length} layout problem(s):`);
  for (const p of allProblems.slice(0, 25)) console.log(`  ! ${p}`);
} else {
  console.log('\nAUDIT → no overlaps or margin spills');
}
