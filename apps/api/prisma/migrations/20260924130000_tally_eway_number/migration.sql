-- Keep the generated e-way bill number read from the linked Tally voucher.
ALTER TABLE "tally_voucher" ADD COLUMN "eWayBillNo" TEXT;
