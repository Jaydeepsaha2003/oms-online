-- Capture the full original save() input on every RECEIPT voucher, plus edit
-- audit fields, so a receipt (and everything saved after it) can later be
-- reversed and replayed if its amount/date/mode needs correcting.
ALTER TABLE "acct_ledger" ADD COLUMN "adjMode" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "selectedInvNos" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "takeAccOn" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "bankName" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "chequeNo" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "cashTransLocation" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "cashRecBy" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "receiptRefId" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "advanceRefId" TEXT;
ALTER TABLE "acct_ledger" ADD COLUMN "editedAt" DATETIME;
ALTER TABLE "acct_ledger" ADD COLUMN "editedByName" TEXT;

-- Tags every allocation/advance/opening-clearance row with the voucher whose
-- save() call created it, independent of refRecId (which records who FUNDED
-- it, a different concept) — the reliable key for "everything this voucher touched."
ALTER TABLE "acct_payment_receipt" ADD COLUMN "sourceVoucherNo" TEXT;
ALTER TABLE "acct_party_advance" ADD COLUMN "sourceVoucherNo" TEXT;
ALTER TABLE "acct_opening_trans" ADD COLUMN "sourceVoucherNo" TEXT;

CREATE INDEX "acct_payment_receipt_sourceVoucherNo_idx" ON "acct_payment_receipt"("sourceVoucherNo");
CREATE INDEX "acct_party_advance_sourceVoucherNo_idx" ON "acct_party_advance"("sourceVoucherNo");
CREATE INDEX "acct_opening_trans_sourceVoucherNo_idx" ON "acct_opening_trans"("sourceVoucherNo");
