-- One OMS invoice <-> one Tally Sales voucher (link, status, reconciliation).
CREATE TABLE "tally_voucher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "challanId" INTEGER,
    "companyGuid" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'HISTORY',
    "tallyGuid" TEXT,
    "tallyMasterId" INTEGER,
    "tallyAlterId" INTEGER,
    "vchNo" TEXT,
    "vchDate" DATETIME,
    "partyLedger" TEXT,
    "amount" REAL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "irnAckNo" TEXT,
    "recon" TEXT NOT NULL,
    "reconNote" TEXT,
    "acceptedRecon" TEXT,
    "acceptedAlterId" INTEGER,
    "acceptedNote" TEXT,
    "acceptedBy" TEXT,
    "acceptedAt" DATETIME,
    "checkedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tally_voucher_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "challans" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tally_voucher_challanId_key" ON "tally_voucher"("challanId");
CREATE UNIQUE INDEX "tally_voucher_tallyGuid_key" ON "tally_voucher"("tallyGuid");
CREATE INDEX "tally_voucher_recon_idx" ON "tally_voucher"("recon");
