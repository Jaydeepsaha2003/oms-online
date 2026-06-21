-- ── Agents: contact + location ──────────────────────────────────────────────
ALTER TABLE "agents" ADD COLUMN "contactNo" TEXT;
ALTER TABLE "agents" ADD COLUMN "state" TEXT;
ALTER TABLE "agents" ADD COLUMN "city" TEXT;

-- ── Rates: link to the customer master by stable code ───────────────────────
ALTER TABLE "gst_rates" ADD COLUMN "customerCode" TEXT;
ALTER TABLE "trans_rates" ADD COLUMN "customerCode" TEXT;

-- Backfill customerCode from the linked customer (by id, then by name).
UPDATE "gst_rates" SET "customerCode" =
  (SELECT c."code" FROM "customers" c WHERE c."id" = "gst_rates"."customerId")
  WHERE "customerId" IS NOT NULL;
UPDATE "gst_rates" SET "customerCode" =
  (SELECT c."code" FROM "customers" c WHERE UPPER(c."partyName") = UPPER("gst_rates"."customerName") LIMIT 1)
  WHERE "customerCode" IS NULL;

UPDATE "trans_rates" SET "customerCode" =
  (SELECT c."code" FROM "customers" c WHERE c."id" = "trans_rates"."customerId")
  WHERE "customerId" IS NOT NULL;
UPDATE "trans_rates" SET "customerCode" =
  (SELECT c."code" FROM "customers" c WHERE UPPER(c."partyName") = UPPER("trans_rates"."customerName") LIMIT 1)
  WHERE "customerCode" IS NULL;

CREATE INDEX "gst_rates_customerCode_idx" ON "gst_rates"("customerCode");
CREATE INDEX "trans_rates_customerCode_idx" ON "trans_rates"("customerCode");

-- ── Catalog: products / designs / design_names / combinations ───────────────
CREATE TABLE "products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "category" TEXT NOT NULL,
    "subCategory" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "size" REAL,
    "weight" REAL,
    "pcs" REAL,
    "rate" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");
CREATE UNIQUE INDEX "products_category_subCategory_product_size_key" ON "products"("category", "subCategory", "product", "size");
CREATE INDEX "products_category_idx" ON "products"("category");
CREATE INDEX "products_product_idx" ON "products"("product");

CREATE TABLE "designs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "category" TEXT NOT NULL,
    "subCategory" TEXT NOT NULL,
    "designType" TEXT NOT NULL,
    "cost" REAL,
    "rate" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "designs_code_key" ON "designs"("code");
CREATE UNIQUE INDEX "designs_category_subCategory_designType_key" ON "designs"("category", "subCategory", "designType");
CREATE INDEX "designs_category_idx" ON "designs"("category");

CREATE TABLE "design_names" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "designType" TEXT NOT NULL,
    "designName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "design_names_designType_key" ON "design_names"("designType");

CREATE TABLE "combinations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "category" TEXT NOT NULL,
    "subCategory" TEXT NOT NULL,
    "designType" TEXT NOT NULL,
    "cost" REAL,
    "rate" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "combinations_code_key" ON "combinations"("code");
CREATE UNIQUE INDEX "combinations_category_subCategory_designType_key" ON "combinations"("category", "subCategory", "designType");
CREATE INDEX "combinations_category_idx" ON "combinations"("category");
