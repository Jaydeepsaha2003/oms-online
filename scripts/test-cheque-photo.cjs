// Cheque photo: saved with the cheque and returned; only a URL from the server's own
// cheques folder is accepted. Isolated fixture DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-cheque-photo-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { ChequesService } = require('../apps/api/src/cheques/cheques.service.ts');
const { CreateChequeDto } = require('../apps/api/src/cheques/dto/cheque.dto.ts');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');

const sql = spawnSync(
  process.execPath,
  [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'apps/api/prisma/schema.prisma'), '--script'],
  { cwd: root, encoding: 'utf8', env: process.env },
);
assert.equal(sql.status, 0, sql.stderr);
const sqlite = new DatabaseSync(dbPath);
sqlite.exec(sql.stdout);
sqlite.close();

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const svc = new ChequesService(prisma);
const errs = (o) => validateSync(plainToInstance(CreateChequeDto, o)).map((e) => e.property);
(async () => {
  let failed = false;
  try {
    const c = await prisma.customer.create({ data: { partyName: 'ANANDA HOME NEEDS' } });
    const base = { partyName: 'ANANDA HOME NEEDS', customerId: c.id, chequeNo: '000123', chequeAmt: 5000, drawerBank: 'AXIS BANK-8254', recDate: '2026-10-09', dueDate: '2026-10-09' };
    const url = '/api/uploads/cheques/1b2c3d4e-0000-4000-8000-000000000000.jpg';
    assert.deepEqual(errs({ ...base, photoUrl: url }), []);
    assert.deepEqual(errs({ ...base, photoUrl: 'https://evil.example/x.jpg' }), ['photoUrl']);
    assert.deepEqual(errs({ ...base, photoUrl: '/api/uploads/order-items/x.jpg' }), ['photoUrl']);
    console.log('PASS only a cheques-folder upload URL is accepted');
    const saved = await svc.create({ ...base, photoUrl: url }, 'T');
    assert.equal(saved.photoUrl, url);
    const cleared = await svc.update(saved.id, { photoUrl: null });
    assert.equal(cleared.photoUrl, null);
    console.log('PASS the photo is saved with the cheque and can be removed');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();