# Automatic startup sync from the persisted Access file — design

Date: 2026-07-08

## Purpose

The legacy MS Access `.accdb` database is still in active daily use alongside
OMS — staff keep entering real orders/dispatch/accounts data into it. Today,
`Settings → Data Import` requires a fresh file upload every time, and the
import for Orders, Dispatch, and every Accounts sub-table (ledger, receipts,
advances, discounts, opening balances/clearances, credit notes) works by
**deleting the entire table and reloading it from scratch** on every run.
This spec makes the import (a) reuse a saved copy of the file automatically
on every server start, and (b) only ever add genuinely new records, never
wipe or overwrite what's already in OMS.

## Scope decisions (confirmed with user)

- **Ongoing, not one-time.** Access stays a live parallel data source
  indefinitely — this is a permanent sync feature, not a one-off migration
  step. The module's current "TEMPORARY — delete this folder when done"
  framing will be removed from its comments so it isn't accidentally
  deleted later.
- **Startup-only trigger.** The sync runs once when the server boots (via
  `start.bat`/`restart.bat`, or any restart), not on a recurring timer while
  already running. If Access gains new rows while OMS has been up for
  hours, they appear at the next restart, not before.
- **Insert-only, never update.** Once a legacy row has been imported, later
  syncs never touch it again — only rows that don't exist in OMS yet get
  added. An edit made inside OMS to an already-imported record can never be
  silently overwritten by the Access side. The trade-off, accepted
  explicitly: an edit made back in the Access file *after* a record was
  already imported will never propagate.
- **File persistence, not a typed path.** The existing upload flow stays as
  the only way to (re)point the sync at a file — after a successful manual
  run, the uploaded `.accdb` is saved to a private, non-web-servable
  location and remembered; every subsequent server start reuses that saved
  copy without requiring a new upload.

## Architecture

```
Settings → Data Import → upload + run (unchanged UI)
    → on success (not dry-run): save the buffer to apps/api/data/access-import/source.accdb
    → remember the path in AppConfig (key: ACCESS_IMPORT_FILE_PATH)

Server startup (onApplicationBootstrap, fire-and-forget — never blocks app.listen())
    → if AppConfig has a path and the file exists on disk:
        run the same import pipeline against that file
        Orders / Dispatch: skip any legacy id already present as an OMS row — insert only new ids
        Accounts tables:    skip any row matching an existing natural-key combination — insert only new rows
        Masters:            unchanged (already upsert-by-key, already safe)
    → write a summary to AppConfig (key: ACCESS_IMPORT_LAST_SYNC) and to the server log
```

### File persistence

- New directory `apps/api/data/access-import/` (NOT under the existing
  `/uploads` static-serving path — this file can contain customer/financial
  data and must never be reachable by URL). Created on demand, matching how
  `ensureUploadDir()` already does this for order-line photos.
- `AccessImportService.run()` gains one addition after a successful,
  non-dry-run import: copy the uploaded buffer to
  `apps/api/data/access-import/source.accdb` and upsert
  `AppConfig['ACCESS_IMPORT_FILE_PATH']` to that path.

### Startup sync

- `AccessImportService` implements `OnApplicationBootstrap`. Its hook reads
  `ACCESS_IMPORT_FILE_PATH` from `AppConfig`; if unset or the file is
  missing, it does nothing (first-ever server start before any manual
  upload has happened, or a moved/deleted file). Otherwise it calls the
  same export→import pipeline `run()` already uses, **without `await`ing it
  from the lifecycle hook** (fire-and-forget, errors caught and logged) so
  a large Access file never delays the server actually starting to listen.
- Only runs on `process.platform === 'win32'` (same guard `run()` already
  has — the ACE OLEDB export only works on the Windows host).

### Insert-only dedupe, per section

- **Orders / Dispatch**: the OMS `id` already *is* the legacy Access ID
  (`id: oid` / `id` in the current create calls) — a single, 100%-reliable
  check. Fetch the set of existing ids once, skip any legacy row whose id
  is already in that set, insert the rest. No more `deleteMany`.
- **Accounts tables** — none of these carry the legacy id forward today
  (they use `@default(autoincrement())`), so "already imported" is
  determined by an **exact match on the fields Access already preserves
  verbatim** for that row type:
  - `AcctLedger`: `voucherNo` + `transDate` + `custId`
  - `AcctPaymentReceipt` / `AcctPartyAdvance`: `refId`
  - `AcctOpeningTrans`: `custId` + `transDate` + `kind` (+ `refRecId` for
    `CLEARANCE` rows, which share `kind` but differ by voucher)
  - `AcctPartyDiscount`: `invNo` + `custId` + `disDate`
  - `CreditNote`: `code` (already `@unique` — same pattern the existing
    Challans import already uses)

  Each is deliberately conservative: an exact match on every one of those
  fields is required to skip a row. Anything not matching gets inserted as
  new, so ambiguity errs toward re-adding rather than ever silently
  dropping real new data.
- **Masters** (customers/products/designs/design names/GST/transport
  rates) and **Challans**: unchanged — both already upsert-by-key today.

### Visibility

`GET /access-import/status` gains the last sync's timestamp and per-section
new-row counts (read from `AppConfig['ACCESS_IMPORT_LAST_SYNC']`, a small
JSON blob written at the end of every run — manual or automatic). The
existing `AccessImportCard` in Settings shows this so the admin can confirm
it's working without reading server logs.

## Edge cases

- **No file ever uploaded yet**: startup hook is a no-op (no
  `ACCESS_IMPORT_FILE_PATH` in `AppConfig`).
- **Saved file path exists but the file was deleted/moved on disk**:
  startup hook checks existence before running; no-op and logs a warning
  if missing, rather than throwing and blocking startup.
- **Export/import fails on startup** (ACE not installed, locked file,
  malformed data): caught and logged; the server continues starting
  normally — a failed background sync must never prevent OMS itself from
  coming up.
- **A row was manually deleted from OMS after being imported** (e.g. an
  admin deleted a bad order): the next sync sees the legacy id no longer
  present and would re-insert it — accepted behavior, consistent with
  "insert only what's missing," though worth knowing about.
- **Two different legacy rows coincidentally share the same natural key**
  for an Accounts table (e.g. two ledger entries with the same voucherNo,
  date, and customer): the second would be treated as "already imported"
  and skipped. Considered acceptable given voucher numbers are expected to
  be unique per the existing "voucher nos ... preserved as-is ... reconcile
  automatically" invariant already relied on elsewhere in this module.

## Testing plan

No automated test runner in this repo (same convention as prior specs).
Manual verification: run a manual import once (persists the file), restart
the server and confirm the log shows the auto-sync ran with all-zero new
counts (nothing new since the manual run), then add a genuinely new order
row to a copy of the Access file, swap it in, restart again, and confirm
exactly that one new order (and nothing else) appears — proving both "skip
existing" and "catch new" work correctly. Also verify a full server restart
with no `.accdb` present at all (fresh checkout) starts up normally with no
errors.

## Out of scope (explicitly deferred)

- Continuous/periodic sync while the server stays running (startup-only,
  per the confirmed scope).
- Any update/overwrite of already-imported rows (insert-only, per the
  confirmed scope).
- A UI to browse or manage the persisted file directly (re-uploading
  through the existing card is how it gets replaced).
