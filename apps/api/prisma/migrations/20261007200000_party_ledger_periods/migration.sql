-- Party Ledger "saved ranges": a party's ledger checked / settled for a period.
-- The latest end date decides where the ledger's date filter starts next time
-- that party is opened. Additive only.
CREATE TABLE "party_ledger_periods" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "party_ledger_periods_customerId_idx" ON "party_ledger_periods"("customerId");
