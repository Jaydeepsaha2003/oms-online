// Party Ledger PDF / Excel carry only the picked columns. Reads the live
// dev.db (no writes) for one real party, so the layout is exercised on real rows.
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.DATABASE_URL = 'file:' + path.resolve(__dirname, '../apps/api/prisma/dev.db').split(path.sep).join('/');
require('ts-node').register({ project: path.join(__dirname, '../apps/api/tsconfig.json'), transpileOnly: true });
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { PartyLedgerService } = require('../apps/api/src/party-ledger/party-ledger.service.ts');
const { PdfService } = require('../apps/api/src/pdf/pdf.service.ts');
const { PartyListsService } = require('../apps/api/src/party-lists/party-lists.service.ts');

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const svc = new PartyLedgerService(prisma, new PdfService(), new PartyListsService(prisma));

const headings = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const row = ws.getRow(ws.views[0].ySplit);
  return row.values.filter((v) => v != null);
};

(async () => {
  let failed = false;
  try {
    const c = await prisma.customer.findFirst({ where: { partyName: 'RAKESH MARKETING' } });
    const base = { customerId: c.id, from: '2026-04-01', to: '2026-10-01' };
    const cases = [
      [undefined, 'BOTH', ['Date', 'Particulars', 'Vch Type', 'Vch No', 'St', 'Due From', 'Debit', 'Credit', 'Debit', 'Credit']],
      ['date,vchNo,dr,cr', 'B', ['Date', 'Vch No', 'Debit', 'Credit']],
      ['vchType,vchNo,dr', 'BOTH', ['Vch Type', 'Vch No', 'Debit', 'Debit']],
    ];
    for (const [cols, mode, want] of cases) {
      const x = await svc.exportExcel({ ...base, mode, cols });
      assert.deepEqual(await headings(x.buffer), want, `excel cols=${cols} mode=${mode}`);
      const p = await svc.exportPdf({ ...base, mode, cols });
      assert.ok(p.buffer.length > 1000 && p.buffer.subarray(0, 4).toString() === '%PDF', `pdf cols=${cols}`);
      console.log(`PASS cols=${cols ?? 'all'} mode=${mode}: Excel headings ${want.join(' | ')}; PDF ${p.buffer.length} bytes`);
    }
    await assert.rejects(svc.exportExcel({ ...base, cols: 'dr,cr' }), /text column/);
    console.log('PASS money-only columns are refused');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
  }
  process.exitCode = failed ? 1 : 0;
})();
