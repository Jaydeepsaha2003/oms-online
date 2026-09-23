-- The Tally ledger each party is billed to, keyed by Tally's GUID.
ALTER TABLE "customers" ADD COLUMN "tallyLedgerGuid" TEXT;
ALTER TABLE "customers" ADD COLUMN "tallyLedgerName" TEXT;
ALTER TABLE "customers" ADD COLUMN "tallyGstin" TEXT;
CREATE INDEX "customers_tallyLedgerGuid_idx" ON "customers"("tallyLedgerGuid");
