-- issueKey gives each reconciliation line a stable identity across uploads (see
-- TallyReconRow.issueKey / TallyReconMark in schema.prisma), so a review mark
-- made on one register carries onto the next upload that still reports the
-- same discrepancy.
--
-- Added NOT NULL with no default: `prisma db push` refuses that outright on a
-- table that already has rows ("Added the required column `issueKey` ...
-- without a default value"), since it has no value to put in the existing
-- ones. So this does the standard SQLite rebuild-and-copy instead, computing
-- the real value for every existing row with the exact formula the app uses
-- for new ones (issueKeyOf() in tally-recon.service.ts):
--   [source, ledgerName.trim().toUpperCase(), vchType, vchNo.trim().toUpperCase(),
--    round((dr - cr) * 100), ymd(txnDate)].join('|')
-- txnDate is stored as a UTC epoch-ms integer; ymd() reads it back with LOCAL
-- (Asia/Kolkata, UTC+5:30) date parts, so `+330 minutes` here keeps the
-- backfilled key on the same calendar day ymd() would report.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_tally_recon_row" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "ledgerName" TEXT NOT NULL,
    "customerId" INTEGER,
    "customerName" TEXT,
    "txnDate" DATETIME NOT NULL,
    "vchType" TEXT NOT NULL,
    "vchNo" TEXT NOT NULL,
    "particulars" TEXT,
    "dr" REAL NOT NULL DEFAULT 0,
    "cr" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "omsRef" TEXT,
    "omsAmount" REAL,
    "omsDate" DATETIME,
    "note" TEXT,
    "resolvedAt" DATETIME,
    "resolvedRef" TEXT,
    "issueKey" TEXT NOT NULL,
    CONSTRAINT "tally_recon_row_runId_fkey" FOREIGN KEY ("runId") REFERENCES "tally_recon_run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_tally_recon_row"
SELECT
    "id", "runId", "source", "ledgerName", "customerId", "customerName", "txnDate",
    "vchType", "vchNo", "particulars", "dr", "cr", "status", "omsRef", "omsAmount",
    "omsDate", "note", "resolvedAt", "resolvedRef",
    "source" || '|' || UPPER(TRIM("ledgerName")) || '|' || "vchType" || '|' ||
    UPPER(TRIM("vchNo")) || '|' || CAST(ROUND(("dr" - "cr") * 100) AS INTEGER) || '|' ||
    strftime('%Y-%m-%d', "txnDate" / 1000, 'unixepoch', '+330 minutes')
FROM "tally_recon_row";

DROP TABLE "tally_recon_row";
ALTER TABLE "new_tally_recon_row" RENAME TO "tally_recon_row";

CREATE INDEX "tally_recon_row_runId_idx" ON "tally_recon_row"("runId");
CREATE INDEX "tally_recon_row_runId_status_idx" ON "tally_recon_row"("runId", "status");
CREATE INDEX "tally_recon_row_runId_vchType_idx" ON "tally_recon_row"("runId", "vchType");
CREATE INDEX "tally_recon_row_issueKey_idx" ON "tally_recon_row"("issueKey");

PRAGMA foreign_keys=ON;
