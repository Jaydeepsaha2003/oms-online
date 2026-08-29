-- Bank Statement reconciliation: a saved working that posts nothing until Process.

CREATE TABLE "bank_statement_run" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fileName" TEXT NOT NULL,
    "bankName" TEXT,
    "fromDate" DATETIME NOT NULL,
    "toDate" DATETIME NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "processedAt" DATETIME,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "creditTotal" REAL NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "partialCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "noPartyCount" INTEGER NOT NULL DEFAULT 0,
    "postedCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX "bank_statement_run_uploadedAt_idx" ON "bank_statement_run"("uploadedAt");

CREATE TABLE "bank_statement_row" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "txnDate" DATETIME NOT NULL,
    "narration" TEXT NOT NULL,
    "refNo" TEXT,
    "amount" REAL NOT NULL,
    "customerId" INTEGER,
    "customerName" TEXT,
    "partySource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NO_PARTY',
    "matchedRefs" TEXT,
    "matchedAmount" REAL NOT NULL DEFAULT 0,
    "note" TEXT,
    "postedRef" TEXT,
    "postedAt" DATETIME,
    CONSTRAINT "bank_statement_row_runId_fkey" FOREIGN KEY ("runId") REFERENCES "bank_statement_run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "bank_statement_row_runId_idx" ON "bank_statement_row"("runId");
CREATE INDEX "bank_statement_row_runId_status_idx" ON "bank_statement_row"("runId", "status");
CREATE INDEX "bank_statement_row_customerId_idx" ON "bank_statement_row"("customerId");

CREATE TABLE "bank_statement_alias" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fragment" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT
);

CREATE UNIQUE INDEX "bank_statement_alias_fragment_key" ON "bank_statement_alias"("fragment");

CREATE TABLE "bank_statement_column_preset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bankName" TEXT NOT NULL,
    "mapJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "bank_statement_column_preset_bankName_key" ON "bank_statement_column_preset"("bankName");
