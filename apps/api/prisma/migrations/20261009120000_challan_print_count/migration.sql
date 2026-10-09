-- How many times each challan's Print button was pressed, and the last time/who.
-- Every challan that exists today counts as printed once (owner's call, 09-10-2026):
-- there is no record of them, and they were printed when made.
ALTER TABLE "challans" ADD COLUMN "printCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "challans" ADD COLUMN "lastPrintedAt" DATETIME;
ALTER TABLE "challans" ADD COLUMN "lastPrintedBy" TEXT;
UPDATE "challans" SET "printCount" = 1;
