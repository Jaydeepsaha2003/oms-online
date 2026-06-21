-- Add auto-generated, human-readable codes for customers and transporters.
-- Codes are assigned by the API on create and shown on export; uploads never
-- need to supply them.

-- AlterTable: new nullable code columns.
ALTER TABLE "customers" ADD COLUMN "code" TEXT;
ALTER TABLE "transporters" ADD COLUMN "code" TEXT;

-- Backfill any existing rows with codes derived from their id (e.g. CUST-00001 / TRN-00001).
UPDATE "customers" SET "code" = printf('CUST-%05d', "id") WHERE "code" IS NULL;
UPDATE "transporters" SET "code" = printf('TRN-%05d', "id") WHERE "code" IS NULL;

-- CreateIndex: enforce uniqueness (SQLite allows multiple NULLs).
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");
CREATE UNIQUE INDEX "transporters_code_key" ON "transporters"("code");
