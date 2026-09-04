-- Lets a Tally ledger be filed as NOT a party (EXPENSE or OTHER), so it stops
-- being reported as "needs a customer mapping" on every future upload/rerun.
-- Every register has ledgers that are genuinely never going to be a customer
-- (bank accounts, GST/tax heads, P&L, Suspense, expense heads...) and today
-- there was no way to tell the reconciliation that once and have it remembered
-- — every run re-asked about every one of them, forever.
--
-- Separate table, not a nullable column on tally_party_alias: a ledger is
-- either mapped to a customer OR filed as non-party here, never both — the
-- service enforces that by deleting one row whenever the other is written.
CREATE TABLE "tally_ledger_category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tallyName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT
);
CREATE UNIQUE INDEX "tally_ledger_category_tallyName_key" ON "tally_ledger_category"("tallyName");
