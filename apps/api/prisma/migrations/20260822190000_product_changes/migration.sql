-- Every non-rate change to a product, one row per field.
--
-- Rate changes already have their own trail in `product_rate_history`, which
-- booking-date repricing depends on — this is separate and deliberately plainer:
-- "who edited what, and when", for the Products screen's Recent Changes view.
--
-- productId is nullable and NOT a foreign key, so the trail survives a product
-- being deleted; `productName` carries the label for exactly that case.
CREATE TABLE "product_changes" (
    "id"            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId"     INTEGER,
    "productName"   TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "field"         TEXT NOT NULL,
    "oldValue"      TEXT,
    "newValue"      TEXT,
    "changedByName" TEXT,
    "changedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "product_changes_productId_idx" ON "product_changes"("productId");
CREATE INDEX "product_changes_changedAt_idx" ON "product_changes"("changedAt");
