-- CreateTable
CREATE TABLE "gst_rates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER,
    "customerName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rate" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "gst_rates_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "trans_rates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER,
    "customerName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "transporterId" INTEGER,
    "transportName" TEXT,
    "rate" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "trans_rates_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trans_rates_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "transporters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "gst_rates_customerId_idx" ON "gst_rates"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "gst_rates_customerName_category_key" ON "gst_rates"("customerName", "category");

-- CreateIndex
CREATE INDEX "trans_rates_customerId_idx" ON "trans_rates"("customerId");

-- CreateIndex
CREATE INDEX "trans_rates_transporterId_idx" ON "trans_rates"("transporterId");
