-- Durable receipt identity across Receive Payments, Bank Reconciliation and
-- Tally Reconciliation. NULL remains valid for historical rows.
ALTER TABLE "acct_ledger" ADD COLUMN "bankRef" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "sourceKey" TEXT;

CREATE UNIQUE INDEX "acct_ledger_bankRef_key" ON "acct_ledger"("bankRef");
CREATE UNIQUE INDEX "acct_ledger_sourceKey_key" ON "acct_ledger"("sourceKey");
