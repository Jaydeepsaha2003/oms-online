-- Tally ledgers queued to be added as OMS customers.
CREATE TABLE "customer_additions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tallyName" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "details" TEXT,
    "tallyOpening" REAL,
    "tallyClosing" REAL,
    "balanceFrom" DATETIME,
    "balanceTo" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "customerId" INTEGER,
    "openingSettled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "addedAt" DATETIME
);
CREATE UNIQUE INDEX "customer_additions_tallyName_key" ON "customer_additions"("tallyName");