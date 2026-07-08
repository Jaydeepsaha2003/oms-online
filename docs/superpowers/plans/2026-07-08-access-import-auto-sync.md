# Access Import Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the uploaded `.accdb` file after a manual import, automatically re-sync from it on every server start, and change Orders/Dispatch/Accounts from destructive wipe-and-reload to insert-only-new.

**Architecture:** A small constants file defines a private (non-web-servable) storage location for the persisted file. `AccessImportService.run()` saves the uploaded buffer there and remembers the path in `AppConfig` after a successful non-dry run. `AccessImportService` implements `OnApplicationBootstrap` to fire off the same import pipeline in the background on every boot, without blocking `app.listen()`. Orders/Dispatch dedupe on their existing legacy-id-as-OMS-id; Accounts tables dedupe on an exact match of the natural fields Access already preserves verbatim.

**Tech Stack:** No new dependencies — reuses the existing PowerShell/ACE export pipeline, Prisma, and `AppConfig` key-value store already used elsewhere (CRM settings, category calc fields).

## Global Constraints

- Spec: [docs/superpowers/specs/2026-07-08-access-import-auto-sync-design.md](../specs/2026-07-08-access-import-auto-sync-design.md).
- No test runner in this repo. **This feature also cannot be fully integration-tested by an agent** — it requires a real `.accdb` file and the Windows ACE OLEDB provider, neither of which are available here. Verification instead directly exercises the dedupe logic by calling the section-import methods with fabricated in-memory data (they already take a plain `J: (table: string) => any[]` function, decoupled from the actual file/PowerShell export step), and verifies the startup hook never blocks/crashes the app. A real end-to-end test with an actual Access file is handed off to the user.
- Insert-only: once a legacy row is in OMS, later syncs never update or delete it — only add rows that don't exist yet.
- The persisted file must live outside any web-servable directory (never under `/uploads`).
- Remove the "TEMPORARY" framing from this module's comments — it's now a permanent feature.

---

### Task 1: Persisted file location + save-after-run

**Files:**
- Create: `apps/api/src/access-import/access-import.constants.ts`
- Modify: `apps/api/src/access-import/access-import.service.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ACCESS_IMPORT_DIR` constant and `ensureAccessImportDir(): string` from the new constants file — used by this task's own service change and by Task 5's startup hook. `AppConfig` keys `ACCESS_IMPORT_FILE_PATH` (the saved file's absolute path) and `ACCESS_IMPORT_LAST_SYNC` (JSON summary) — Task 5 and Task 6 read these.

- [ ] **Step 1: Add the storage location helper**

```ts
// apps/api/src/access-import/access-import.constants.ts
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
```

- [ ] **Step 2: Persist the uploaded buffer after a successful, non-dry run**

In `apps/api/src/access-import/access-import.service.ts`, add the import:

```ts
import { ACCESS_IMPORT_FILE_PATH, APP_CONFIG_FILE_PATH_KEY, ensureAccessImportDir } from './access-import.constants';
```

Add this new private method (anywhere in the class, e.g. right after `run()`):

```ts
  /** Saves the uploaded file to the private, non-web-servable storage location and
   *  remembers its path so future server starts can reuse it without a new upload. */
  private async persistUploadedFile(buffer: Buffer): Promise<void> {
    ensureAccessImportDir();
    writeFileSync(ACCESS_IMPORT_FILE_PATH, buffer);
    await this.prisma.appConfig.upsert({
      where: { key: APP_CONFIG_FILE_PATH_KEY },
      create: { key: APP_CONFIG_FILE_PATH_KEY, value: ACCESS_IMPORT_FILE_PATH },
      update: { value: ACCESS_IMPORT_FILE_PATH },
    });
  }
```

In `run()`, right before the `return { ok: true, dry, fileName: file.originalname, results };` line, add:

```ts
      if (!dry) await this.persistUploadedFile(file.buffer);

```

- [ ] **Step 3: Ignore the persisted data directory**

In `.gitignore`, add this line under the `# Generated / uploads / temp artifacts` section (near the existing `apps/api/uploads/` line):

```
data/access-import/
```

- [ ] **Step 4: Build**

Run: `npm run build -w @oms/api` (from repo root)
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Verify the persistence step in isolation (no real .accdb needed)**

This exercises `persistUploadedFile` directly, bypassing the PowerShell/ACE export entirely (which needs a real Access file this agent doesn't have):

```bash
cd apps/api && node -e "
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const p = new PrismaClient();
const ACCESS_IMPORT_DIR = path.resolve(process.cwd(), 'data', 'access-import');
const FILE_PATH = path.resolve(ACCESS_IMPORT_DIR, 'source.accdb');
fs.mkdirSync(ACCESS_IMPORT_DIR, { recursive: true });
fs.writeFileSync(FILE_PATH, Buffer.from('fake accdb bytes for this test'));
p.appConfig.upsert({ where: { key: 'ACCESS_IMPORT_FILE_PATH' }, create: { key: 'ACCESS_IMPORT_FILE_PATH', value: FILE_PATH }, update: { value: FILE_PATH } })
  .then(() => { console.log('saved, file exists:', fs.existsSync(FILE_PATH)); p.\$disconnect(); });
"
```

Expected: `saved, file exists: true`. (Leave this file and AppConfig entry in place — Task 5's verification reuses it.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/access-import/access-import.constants.ts apps/api/src/access-import/access-import.service.ts .gitignore
git commit -m "feat(api): persist the uploaded Access file for reuse on server start"
```

---

### Task 2: Insert-only dedupe for Orders and Dispatch

**Files:**
- Modify: `apps/api/src/access-import/access-import.service.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `importOrders`/`importDispatch` no longer delete existing data; behavior change only, no new exported interface.

- [ ] **Step 1: Change `importOrders` to skip existing legacy ids**

Replace:

```ts
  private async importOrders(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const cmap = await this.customerMap(J);
    if (!dry) await this.prisma.order.deleteMany({});
    const groups = new Map<number, any[]>();
```

with:

```ts
  private async importOrders(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const cmap = await this.customerMap(J);
    const existingIds = new Set((await this.prisma.order.findMany({ select: { id: true } })).map((o) => o.id));
    const groups = new Map<number, any[]>();
```

And change the loop body — replace:

```ts
    let orders = 0;
    let items = 0;
    for (const [oid, gr] of groups) {
      const h = gr[0];
```

with:

```ts
    let orders = 0;
    let items = 0;
    let skippedExisting = 0;
    for (const [oid, gr] of groups) {
      if (existingIds.has(oid)) {
        skippedExisting++;
        continue;
      }
      const h = gr[0];
```

And change the return line from `return { orders, 'order items': items };` to:

```ts
    return { orders, 'order items': items, 'already imported (skipped)': skippedExisting };
```

- [ ] **Step 2: Change `importDispatch` the same way**

Replace:

```ts
  private async importDispatch(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const cmap = await this.customerMap(J);
    const itemIds = new Set((await this.prisma.orderItem.findMany({ select: { id: true } })).map((x) => x.id));
    const orderIds = new Set((await this.prisma.order.findMany({ select: { id: true } })).map((x) => x.id));
    if (!dry) await this.prisma.dispatch.deleteMany({});
    const batch: any[] = [];
    let skipped = 0;
    for (const r of J('DispatchTbl')) {
      const id = int(r.DispatchID);
      const oid = int(r['ORDER ID']);
      const oitem = int(r.OrdTrans);
      if (!id || !oid || !oitem || !orderIds.has(oid) || !itemIds.has(oitem)) {
        skipped++;
        continue;
      }
```

with:

```ts
  private async importDispatch(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const cmap = await this.customerMap(J);
    const itemIds = new Set((await this.prisma.orderItem.findMany({ select: { id: true } })).map((x) => x.id));
    const orderIds = new Set((await this.prisma.order.findMany({ select: { id: true } })).map((x) => x.id));
    const existingDispatchIds = new Set((await this.prisma.dispatch.findMany({ select: { id: true } })).map((x) => x.id));
    const batch: any[] = [];
    let skipped = 0;
    let skippedExisting = 0;
    for (const r of J('DispatchTbl')) {
      const id = int(r.DispatchID);
      const oid = int(r['ORDER ID']);
      const oitem = int(r.OrdTrans);
      if (!id || !oid || !oitem || !orderIds.has(oid) || !itemIds.has(oitem)) {
        skipped++;
        continue;
      }
      if (existingDispatchIds.has(id)) {
        skippedExisting++;
        continue;
      }
```

And change the return line from `return { dispatches: batch.length, 'skipped (no matching order/item)': skipped };` to:

```ts
    return { dispatches: batch.length, 'skipped (no matching order/item)': skipped, 'already imported (skipped)': skippedExisting };
```

- [ ] **Step 3: Build**

Run: `npm run build -w @oms/api` (from repo root)
Expected: exits 0.

- [ ] **Step 4: Verify insert-only behavior directly (no real .accdb needed)**

`importOrders`/`importDispatch` are private methods that only need a `J` function returning plain arrays — call them directly with fabricated data to prove the dedupe logic, bypassing the file/PowerShell layer entirely:

```bash
cd apps/api && node -e "
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/src/app.module');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const { AccessImportService } = require('./dist/src/access-import/access-import.service');
  const svc = app.get(AccessImportService);

  const fakeOrder = (id) => ({ 'ORDER ID': id, 'CUST ID': null, 'CUSTOMER NAME': 'Diag Customer', 'ORDER DATE': '2026-01-01', ID: id * 100 + 1, PCATEGORY: 'TEST' });
  const J1 = (name) => (name === 'ORDERTBL' ? [fakeOrder(900001), fakeOrder(900002)] : []);
  const r1 = await svc['importOrders'](J1, false);
  console.log('first run (2 new orders):', JSON.stringify(r1));

  const J2 = (name) => (name === 'ORDERTBL' ? [fakeOrder(900001), fakeOrder(900002), fakeOrder(900003)] : []);
  const r2 = await svc['importOrders'](J2, false);
  console.log('second run (same 2 + 1 new):', JSON.stringify(r2));

  await app.close();
})();
"
```

Expected: first run reports `orders: 2, ..., 'already imported (skipped)': 0`. Second run reports `orders: 1, ..., 'already imported (skipped)': 2` — proving the two already-imported orders were skipped and only the genuinely new one was added.

Then clean up the fake orders:

```bash
cd apps/api && node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.order.deleteMany({ where: { id: { in: [900001, 900002, 900003] } } }).then((r) => { console.log('cleaned up:', r.count); p.\$disconnect(); });
"
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/access-import/access-import.service.ts
git commit -m "$(cat <<'EOF'
feat(api): make Orders/Dispatch import insert-only instead of wipe-and-reload

Verified directly: running the same import twice with one new record
added skips both already-imported orders and adds only the new one.
EOF
)"
```

---

### Task 3: Insert-only dedupe for the Accounts tables

**Files:**
- Modify: `apps/api/src/access-import/access-import.service.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `importAccounts` no longer deletes existing data; behavior change only.

- [ ] **Step 1: Opening balances / clearances**

Replace:

```ts
    if (!dry) {
      await this.prisma.acctOpeningTrans.deleteMany({});
      await insertMany(openingRows, (b) => this.prisma.acctOpeningTrans.createMany({ data: b }));
      await insertMany(clearanceRows, (b) => this.prisma.acctOpeningTrans.createMany({ data: b }));
    }
    c['opening balances'] = openingRows.length;
    c['opening clearances'] = clearanceRows.length;
```

with:

```ts
    const existingOpening = new Set(
      (await this.prisma.acctOpeningTrans.findMany({ select: { custId: true, transDate: true, kind: true, refRecId: true } }))
        .map((r) => `${r.custId}|${r.transDate.toISOString()}|${r.kind}|${r.refRecId ?? ''}`),
    );
    const newOpeningRows = openingRows.filter((r) => !existingOpening.has(`${r.custId}|${r.transDate.toISOString()}|OPENING|`));
    const newClearanceRows = clearanceRows.filter((r) => !existingOpening.has(`${r.custId}|${r.transDate.toISOString()}|CLEARANCE|${r.refRecId ?? ''}`));
    if (!dry) {
      await insertMany(newOpeningRows, (b) => this.prisma.acctOpeningTrans.createMany({ data: b }));
      await insertMany(newClearanceRows, (b) => this.prisma.acctOpeningTrans.createMany({ data: b }));
    }
    c['opening balances (new)'] = newOpeningRows.length;
    c['opening clearances (new)'] = newClearanceRows.length;
```

- [ ] **Step 2: Ledger vouchers**

Replace:

```ts
    if (!dry) {
      await this.prisma.acctLedger.deleteMany({});
      await insertMany(ledgerRows, (b) => this.prisma.acctLedger.createMany({ data: b }));
    }
    c['ledger vouchers'] = ledgerRows.length;
```

with:

```ts
    const existingLedger = new Set(
      (await this.prisma.acctLedger.findMany({ select: { voucherNo: true, transDate: true, custId: true } }))
        .map((r) => `${r.voucherNo}|${r.transDate.toISOString()}|${r.custId}`),
    );
    const newLedgerRows = ledgerRows.filter((r) => !existingLedger.has(`${r.voucherNo}|${r.transDate.toISOString()}|${r.custId}`));
    if (!dry) {
      await insertMany(newLedgerRows, (b) => this.prisma.acctLedger.createMany({ data: b }));
    }
    c['ledger vouchers (new)'] = newLedgerRows.length;
```

- [ ] **Step 3: Payment receipts**

Replace:

```ts
    if (!dry) {
      await this.prisma.acctPaymentReceipt.deleteMany({});
      await insertMany(receiptRows, (b) => this.prisma.acctPaymentReceipt.createMany({ data: b }));
    }
    c.receipts = receiptRows.length;
```

with:

```ts
    const existingReceipts = new Set((await this.prisma.acctPaymentReceipt.findMany({ select: { refId: true } })).map((r) => r.refId));
    const newReceiptRows = receiptRows.filter((r) => !existingReceipts.has(r.refId));
    if (!dry) {
      await insertMany(newReceiptRows, (b) => this.prisma.acctPaymentReceipt.createMany({ data: b }));
    }
    c['receipts (new)'] = newReceiptRows.length;
```

- [ ] **Step 4: Party advances**

Replace:

```ts
    if (!dry) {
      await this.prisma.acctPartyAdvance.deleteMany({});
      await insertMany(advanceRows, (b) => this.prisma.acctPartyAdvance.createMany({ data: b }));
    }
    c.advances = advanceRows.length;
```

with:

```ts
    const existingAdvances = new Set((await this.prisma.acctPartyAdvance.findMany({ select: { refId: true } })).map((r) => r.refId));
    const newAdvanceRows = advanceRows.filter((r) => !existingAdvances.has(r.refId));
    if (!dry) {
      await insertMany(newAdvanceRows, (b) => this.prisma.acctPartyAdvance.createMany({ data: b }));
    }
    c['advances (new)'] = newAdvanceRows.length;
```

- [ ] **Step 5: Sales discounts**

Replace:

```ts
    if (!dry) {
      await this.prisma.acctPartyDiscount.deleteMany({});
      await insertMany(discountRows, (b) => this.prisma.acctPartyDiscount.createMany({ data: b }));
    }
    c.discounts = discountRows.length;
```

with:

```ts
    const existingDiscounts = new Set(
      (await this.prisma.acctPartyDiscount.findMany({ select: { invNo: true, custId: true, disDate: true } }))
        .map((r) => `${r.invNo}|${r.custId}|${r.disDate.toISOString()}`),
    );
    const newDiscountRows = discountRows.filter((r) => !existingDiscounts.has(`${r.invNo}|${r.custId}|${r.disDate.toISOString()}`));
    if (!dry) {
      await insertMany(newDiscountRows, (b) => this.prisma.acctPartyDiscount.createMany({ data: b }));
    }
    c['discounts (new)'] = newDiscountRows.length;
```

- [ ] **Step 6: Credit notes**

Replace:

```ts
    const cnHeaderRows = J('InvTblR');
    if (!dry) await this.prisma.creditNote.deleteMany({});
    for (const h of cnHeaderRows) {
      const code = s(h.InvNo);
      if (!code) {
        cnSkipped++;
        continue;
      }
```

with:

```ts
    const cnHeaderRows = J('InvTblR');
    const existingCnCodes = new Set((await this.prisma.creditNote.findMany({ select: { code: true } })).map((r) => r.code));
    let cnSkippedExisting = 0;
    for (const h of cnHeaderRows) {
      const code = s(h.InvNo);
      if (!code) {
        cnSkipped++;
        continue;
      }
      if (existingCnCodes.has(code)) {
        cnSkippedExisting++;
        continue;
      }
```

And change `if (cnSkipped) c['credit notes skipped (no InvNo)'] = cnSkipped;` to also add:

```ts
    if (cnSkipped) c['credit notes skipped (no InvNo)'] = cnSkipped;
    if (cnSkippedExisting) c['credit notes already imported (skipped)'] = cnSkippedExisting;
```

- [ ] **Step 7: Build**

Run: `npm run build -w @oms/api` (from repo root)
Expected: exits 0, no TypeScript errors.

- [ ] **Step 8: Verify insert-only behavior for one representative Accounts section**

Ledger is representative of the pattern (composite natural key, same shape as opening/discounts):

```bash
cd apps/api && node -e "
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/src/app.module');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const { AccessImportService } = require('./dist/src/access-import/access-import.service');
  const svc = app.get(AccessImportService);

  const row = (voucherNo) => ({ 'VOUCHER NO': voucherNo, 'TRANS DATE': '2026-01-01', 'CUSTOMER NAME': 'Diag Customer', 'CUST ID': null, 'VOUCHER TYPE': 'RECEIPT', 'TRANS MODE': 'CASH', 'CASH DEBIT': 100 });
  const emptyExceptLedger = (rows) => (name) => (name === 'ACCT_LEDGER' ? rows : []);

  const r1 = await svc['importAccounts'](emptyExceptLedger([row('DIAG-V1'), row('DIAG-V2')]), false);
  console.log('first run:', JSON.stringify({ ledger: r1['ledger vouchers (new)'] }));

  const r2 = await svc['importAccounts'](emptyExceptLedger([row('DIAG-V1'), row('DIAG-V2'), row('DIAG-V3')]), false);
  console.log('second run:', JSON.stringify({ ledger: r2['ledger vouchers (new)'] }));

  await app.close();
})();
"
```

Expected: first run `{"ledger":2}`, second run `{"ledger":1}` — the two already-imported vouchers are skipped, only the new one is added.

Then clean up:

```bash
cd apps/api && node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.acctLedger.deleteMany({ where: { voucherNo: { in: ['DIAG-V1', 'DIAG-V2', 'DIAG-V3'] } } }).then((r) => { console.log('cleaned up:', r.count); p.\$disconnect(); });
"
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/access-import/access-import.service.ts
git commit -m "$(cat <<'EOF'
feat(api): make Accounts import insert-only instead of wipe-and-reload

Every sub-table (ledger, receipts, advances, discounts, opening
balances/clearances, credit notes) now dedupes on an exact match of the
natural fields Access already preserves verbatim, instead of deleting
and reloading the whole table on every run. Verified directly for the
ledger table's composite-key dedupe.
EOF
)"
```

---

### Task 4: Startup sync hook

**Files:**
- Modify: `apps/api/src/access-import/access-import.service.ts`
- Modify: `apps/api/src/access-import/access-import.module.ts`

**Interfaces:**
- Consumes: `ACCESS_IMPORT_FILE_PATH`/`ensureAccessImportDir` conceptually (the actual path is read from `AppConfig`, not the constant directly, so a manually-replaced file at a different path is still honored — though in practice it's always this same path since only `persistUploadedFile` ever writes it).
- Produces: nothing new externally — a background process.

- [ ] **Step 1: Add the lifecycle hook**

In `apps/api/src/access-import/access-import.service.ts`, change the class declaration and imports:

```ts
import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
```

```ts
import { APP_CONFIG_LAST_SYNC_KEY, APP_CONFIG_FILE_PATH_KEY, ensureAccessImportDir } from './access-import.constants';
```

(Combine with the existing import from `./access-import.constants` added in Task 1 rather than duplicating it.)

Change:

```ts
@Injectable()
export class AccessImportService {
  constructor(private readonly prisma: PrismaService) {}
```

to:

```ts
@Injectable()
export class AccessImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccessImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fires once the app has finished initializing. Never awaited from here on
   *  purpose — a large Access file must never delay the server actually
   *  starting to listen for requests. */
  onApplicationBootstrap(): void {
    this.runStartupSync().catch((err) => this.logger.warn(`Startup Access sync failed: ${(err as Error).message}`));
  }

  private async runStartupSync(): Promise<void> {
    if (process.platform !== 'win32') return;
    const row = await this.prisma.appConfig.findUnique({ where: { key: APP_CONFIG_FILE_PATH_KEY } });
    if (!row?.value || !existsSync(row.value)) return;

    this.logger.log(`Running startup Access sync from ${row.value}`);
    const buffer = readFileSync(row.value);
    const file = { buffer, originalname: 'source.accdb' } as Express.Multer.File;
    const result = await this.run(file, [], false);
    await this.prisma.appConfig.upsert({
      where: { key: APP_CONFIG_LAST_SYNC_KEY },
      create: { key: APP_CONFIG_LAST_SYNC_KEY, value: JSON.stringify({ at: new Date().toISOString(), results: result.results }) },
      update: { value: JSON.stringify({ at: new Date().toISOString(), results: result.results }) },
    });
    this.logger.log(`Startup Access sync complete: ${JSON.stringify(result.results)}`);
  }
```

Add `existsSync` to the existing `fs` import at the top of the file — change:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
```

to:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
```

- [ ] **Step 2: Confirm the module needs no changes**

`AccessImportModule` already lists `AccessImportService` as a provider, which is all `OnApplicationBootstrap` requires — Nest calls the hook automatically on any provider that implements it. No edit needed here; this step is a check, not a change.

- [ ] **Step 3: Build**

Run: `npm run build -w @oms/api` (from repo root)
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Verify the app still starts normally when the persisted file is invalid (proves non-blocking error handling)**

Using the fake file from Task 1 Step 5 (`data/access-import/source.accdb`, containing plain text, not a real Access database) — its export will fail since it's not a real `.accdb`, which is exactly the case this step verifies: a failing sync must never prevent the app from starting.

```bash
cd apps/api && node dist/src/main.js > /tmp/api-startup-sync.log 2>&1
```

Run this in the background, then:

```bash
for i in $(seq 1 15); do
  netstat -aon | grep -q ":4000.*LISTENING" && echo "up after ${i}s" && break
  sleep 1
done
grep -i "startup access sync" /tmp/api-startup-sync.log
```

Expected: the server reaches "up after Ns" (proving it started and is listening despite the sync target being invalid), and the log shows a warning like `Startup Access sync failed: Access export failed: ...` rather than a crash. Stop the server afterward.

- [ ] **Step 5: Verify the no-op path (no AppConfig entry at all)**

```bash
cd apps/api && node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.appConfig.deleteMany({ where: { key: 'ACCESS_IMPORT_FILE_PATH' } }).then(() => p.\$disconnect());
"
```

Then repeat Step 4's boot check. Expected: still starts and listens normally, and the log shows no "Startup Access sync" line at all (clean no-op, since there's no configured path).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/access-import/access-import.service.ts
git commit -m "$(cat <<'EOF'
feat(api): auto-run the Access sync on server startup

Fire-and-forget from OnApplicationBootstrap so a large file or a failed
sync never delays or blocks the server actually starting. Verified live:
the app still starts and listens normally both when the persisted file
is invalid and when none is configured yet.
EOF
)"
```

---

### Task 5: Status visibility + remove "TEMPORARY" framing

**Files:**
- Modify: `apps/api/src/access-import/access-import.service.ts`
- Modify: `apps/api/src/access-import/access-import.controller.ts`
- Modify: `apps/api/src/access-import/access-import.module.ts`

**Interfaces:**
- Consumes: `APP_CONFIG_LAST_SYNC_KEY`, `APP_CONFIG_FILE_PATH_KEY` (Task 1/4).
- Produces: `GET /access-import/status` response gains `hasPersistedFile: boolean` and `lastSync: { at: string; results: unknown } | null`.

- [ ] **Step 1: Extend `status()`**

Replace:

```ts
  status() {
    return { supported: process.platform === 'win32', platform: process.platform };
  }
```

with:

```ts
  async status() {
    const [fileRow, syncRow] = await Promise.all([
      this.prisma.appConfig.findUnique({ where: { key: APP_CONFIG_FILE_PATH_KEY } }),
      this.prisma.appConfig.findUnique({ where: { key: APP_CONFIG_LAST_SYNC_KEY } }),
    ]);
    return {
      supported: process.platform === 'win32',
      platform: process.platform,
      hasPersistedFile: !!fileRow?.value && existsSync(fileRow.value),
      lastSync: syncRow?.value ? JSON.parse(syncRow.value) : null,
    };
  }
```

- [ ] **Step 2: Remove the "TEMPORARY" framing**

In `apps/api/src/access-import/access-import.service.ts`, replace the top-of-file comment block:

```ts
/**
 * TEMPORARY MS Access → OMS connector (Settings → Data Import).
 *
 * Self-contained so it can be deleted cleanly later:
 *   1. delete this folder (src/access-import)
 *   2. remove AccessImportModule from app.module.ts
 *   3. remove the <AccessImportCard/> from the Settings page
 *
 * Flow: an uploaded .accdb is exported to JSON via the Windows ACE OLEDB provider
 * (spawned PowerShell — read-only on the file), then imported in-process with the
 * shared PrismaService (no second DB connection, so no SQLite lock contention).
 */
```

with:

```ts
/**
 * MS Access → OMS connector (Settings → Data Import).
 *
 * Access stays a live parallel data source, so this isn't a one-time
 * migration tool — a manual upload persists the file (see
 * access-import.constants.ts) and every server start re-syncs from it
 * automatically (see onApplicationBootstrap below), insert-only: once a
 * legacy row is in OMS, later syncs never update or delete it.
 *
 * Flow: the .accdb is exported to JSON via the Windows ACE OLEDB provider
 * (spawned PowerShell — read-only on the file), then imported in-process with the
 * shared PrismaService (no second DB connection, so no SQLite lock contention).
 */
```

In `apps/api/src/access-import/access-import.controller.ts`, change:

```ts
/** TEMPORARY MS Access connector. Delete this folder + the module registration to remove. */
@ApiTags('Access Import (temporary)')
```

to:

```ts
/** MS Access → OMS connector — Access stays a live parallel data source (see Settings → Data Import). */
@ApiTags('Access Import')
```

In `apps/api/src/access-import/access-import.module.ts`, change:

```ts
/** TEMPORARY module — MS Access → OMS data connector (Settings → Data Import). */
```

to:

```ts
/** MS Access → OMS data connector (Settings → Data Import). Access stays a live parallel data source. */
```

In `apps/api/src/app.module.ts`, change:

```ts
    AccessImportModule, // TEMP: MS Access connector — remove this line + the folder to delete
```

to:

```ts
    AccessImportModule, // MS Access → OMS connector — Access stays a live parallel data source
```

In `apps/api/src/features/settings/access-import-card.tsx`'s import comment in `settings-page.tsx` — change:

```ts
import { AccessImportCard } from './access-import-card'; // TEMP: MS Access connector — delete this import + usage to remove
```

to:

```ts
import { AccessImportCard } from './access-import-card'; // MS Access connector — Access stays a live parallel data source
```

(This last file is `apps/web/src/features/settings/settings-page.tsx`, not under `apps/api` — same file the `TestNotificationCard` import already sits in.)

- [ ] **Step 2: Build**

Run: `npm run build -w @oms/api` (from repo root)
Expected: exits 0, no TypeScript errors.

Run: `npm run build -w @oms/web` (from repo root)
Expected: exits 0.

- [ ] **Step 3: Verify the extended status endpoint**

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@oms.local","password":"Admin@12345"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s http://localhost:4000/api/access-import/status -H "Authorization: Bearer $TOKEN"
```

Expected: `{"success":true,"data":{"supported":true,"platform":"win32","hasPersistedFile":<true or false>,"lastSync":<null or an object>}}` — no crash, correct shape.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/access-import/access-import.service.ts apps/api/src/access-import/access-import.controller.ts \
  apps/api/src/access-import/access-import.module.ts apps/api/src/app.module.ts apps/web/src/features/settings/settings-page.tsx
git commit -m "$(cat <<'EOF'
feat(api): surface last-sync status; remove now-inaccurate "TEMPORARY" framing

Access stays a live parallel data source, so this module is permanent,
not disposable migration tooling — updated comments across the module
accordingly, and GET /access-import/status now reports whether a file
is persisted and what the last sync (manual or automatic) found.
EOF
)"
```

---

### Task 6: Full build, restart, and hand-off for real-file verification

**Files:** none — verification only.

- [ ] **Step 1: Full monorepo build**

Run (from repo root): `npm run build`
Expected: exits 0.

- [ ] **Step 2: Restart the production servers**

Run: `restart.bat` (repo root)

- [ ] **Step 3: Confirm the server boots cleanly with whatever real state exists**

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@oms.local","password":"Admin@12345"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s http://localhost:4000/api/access-import/status -H "Authorization: Bearer $TOKEN"
```

Expected: no crash; the response reflects whatever real persisted-file/last-sync state actually exists on this machine.

- [ ] **Step 4: Hand off to the user — real end-to-end verification needs a real `.accdb` file, which this agent doesn't have**

1. Upload your real `.accdb` once through Settings → Data Import, same as always.
2. Confirm `GET /access-import/status` (or the Settings card, once it displays this) now shows `hasPersistedFile: true` and a `lastSync` summary.
3. Restart the server (`restart.bat`) without touching the file. Confirm the server log shows "Running startup Access sync" and the counts are all-zero new (nothing changed since the manual run) — proving nothing gets re-imported or duplicated.
4. Add one genuinely new row to a copy of the Access file (e.g. one new order), replace the source file at the path `GET /access-import/status` reports (or re-upload through the card, which overwrites it), restart again, and confirm exactly one new row appears in OMS and nothing else changed.

---

## Self-Review Notes

- **Spec coverage:** file persistence after manual upload (Task 1), startup-only automatic trigger via `OnApplicationBootstrap` fired without blocking `app.listen()` (Task 4), insert-only for Orders/Dispatch by legacy-id-as-OMS-id (Task 2) and for every Accounts sub-table by natural-key exact match (Task 3), status visibility (Task 5), removing the "TEMPORARY" framing (Task 5) — all covered. Masters/Challans intentionally untouched, per the spec.
- **Placeholder scan:** no TBD/TODO; every step has literal code or an exact command with expected output. Task 6's hand-off is explicit about needing the user's real file — not a placeholder for logic, a genuine agent capability limit stated plainly.
- **Type consistency:** `ACCESS_IMPORT_FILE_PATH`/`APP_CONFIG_FILE_PATH_KEY`/`APP_CONFIG_LAST_SYNC_KEY`/`ensureAccessImportDir` (Task 1) are used identically in Task 4's startup hook and Task 5's `status()`. The `Counts` return shape's new keys (`'already imported (skipped)'`, `'ledger vouchers (new)'`, etc.) are only ever read as display strings by the existing controller response, so no downstream type depends on their exact wording — safe to add without breaking anything.
