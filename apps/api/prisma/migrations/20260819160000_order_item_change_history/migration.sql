
-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "quotationItemId" INTEGER;

-- CreateTable
CREATE TABLE "order_item_changes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "orderItemId" INTEGER,
    "quotationId" INTEGER,
    "quotationItemId" INTEGER,
    "kind" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "itemLabel" TEXT,
    "changedByName" TEXT,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_item_changes_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "order_item_changes_orderId_idx" ON "order_item_changes"("orderId");

-- CreateIndex
CREATE INDEX "order_item_changes_quotationId_idx" ON "order_item_changes"("quotationId");

-- CreateIndex
CREATE INDEX "order_item_changes_orderItemId_idx" ON "order_item_changes"("orderItemId");

-- CreateIndex
CREATE INDEX "order_items_quotationItemI