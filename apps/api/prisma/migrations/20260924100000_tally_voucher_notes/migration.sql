-- Credit / debit notes join the OMS <-> Tally link table.
ALTER TABLE "tally_voucher" ADD COLUMN "vchType" TEXT NOT NULL DEFAULT 'Sales';
ALTER TABLE "tally_voucher" ADD COLUMN "creditNoteId" INTEGER;
CREATE UNIQUE INDEX "tally_voucher_creditNoteId_key" ON "tally_voucher"("creditNoteId");
