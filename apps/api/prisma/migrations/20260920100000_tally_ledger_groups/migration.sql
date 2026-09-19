-- Tally groups replace the manual Agent/Expense/Other filing.
DROP TABLE IF EXISTS "tally_ledger_category";

CREATE TABLE "tally_ledgers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "tally_ledgers_name_key" ON "tally_ledgers"("name");