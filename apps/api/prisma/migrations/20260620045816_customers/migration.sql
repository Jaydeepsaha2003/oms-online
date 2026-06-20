-- CreateTable
CREATE TABLE "transporters" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "packing" REAL,
    "freight" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "customers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partySource" TEXT,
    "agentName" TEXT,
    "category" TEXT,
    "partyName" TEXT,
    "billingRate" REAL,
    "transporterId" INTEGER,
    "transportName" TEXT,
    "bagName" TEXT,
    "packing" REAL,
    "freight" REAL,
    "boxRate" INTEGER,
    "creditPeriod" INTEGER,
    "city" TEXT,
    "state" TEXT,
    "region" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "brand" TEXT,
    "billRatePc" REAL,
    "payBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customers_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "transporters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "transporters_name_key" ON "transporters"("name");

-- CreateIndex
CREATE INDEX "customers_partyName_idx" ON "customers"("partyName");

-- CreateIndex
CREATE INDEX "customers_agentName_idx" ON "customers"("agentName");

-- CreateIndex
CREATE INDEX "customers_category_idx" ON "customers"("category");

-- CreateIndex
CREATE INDEX "customers_transporterId_idx" ON "customers"("transporterId");
