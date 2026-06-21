-- Orders: header + line items.

CREATE TABLE "orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "customerId" INTEGER,
    "customerName" TEXT NOT NULL,
    "agentName" TEXT,
    "category" TEXT,
    "orderDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completionDate" DATETIME,
    "completionDay" INTEGER,
    "priority" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ordType" TEXT NOT NULL DEFAULT 'SALES ORDER',
    "comment" TEXT,
    "userName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_orderDate_idx" ON "orders"("orderDate");

CREATE TABLE "order_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "pCategory" TEXT,
    "subCategory" TEXT,
    "product" TEXT,
    "design" TEXT,
    "productName" TEXT,
    "designType" TEXT,
    "psize" REAL,
    "bags" REAL,
    "pcs" REAL,
    "gram" REAL,
    "box" REAL,
    "productRate" REAL,
    "designRate" REAL,
    "rate" REAL,
    "calField" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");
