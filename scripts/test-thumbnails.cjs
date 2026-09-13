// Self-contained check for apps/api/src/uploads/thumbnails.ts.
// Uses a throwaway UPLOADS_DIR — never touches the real /uploads folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-thumbs-'));
process.env.UPLOADS_DIR = dir;
require('ts-node').register({ project: path.join(__dirname, '../apps/api/tsconfig.json'), transpileOnly: true });
const sharp = require('sharp');
const { serveThumbnail } = require('../apps/api/src/uploads/thumbnails.ts');

function call(p) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      type() { return this; },
      end() { resolve({ status: this.statusCode }); },
      redirect(c, to) { resolve({ status: c, to }); },
      sendFile(file, opts) { resolve({ status: 200, file, opts, headers: this.headers }); },
    };
    serveThumbnail({ method: 'GET', path: p }, res, () => resolve({ status: 'next' }));
  });
}

(async () => {
  fs.mkdirSync(path.join(dir, 'order-items'));
  // 2000x1000 landscape tagged EXIF orientation 6 — must come out portrait.
  await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#888' } })
    .jpeg().withMetadata({ orientation: 6 }).toFile(path.join(dir, 'order-items', 'abc-123.jpg'));

  const ok = await call('/order-items/abc-123.jpg');
  assert.equal(ok.status, 200);
  assert.equal(ok.opts.dotfiles, 'allow', 'cache lives in .thumbs — sendFile must be allowed to read it');
  assert.equal(ok.headers['content-security-policy'], "default-src 'none'");
  const meta = await sharp(ok.file).metadata();
  assert.ok(meta.width <= 360 && meta.height <= 360, `resized to <=360: ${meta.width}x${meta.height}`);
  assert.ok(meta.height > meta.width, 'EXIF orientation honoured (portrait)');

  for (const bad of ['/secrets/abc-123.jpg', '/order-items/../x.jpg', '/order-items/a/b.jpg', '/order-items/x.svg', '/order-items/missing.jpg']) {
    assert.equal((await call(bad)).status, 404, `rejected: ${bad}`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('thumbnails: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
