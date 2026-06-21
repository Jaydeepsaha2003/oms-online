-- Agents master table. Backfilled from existing customer agent names so the
-- agents already in use appear immediately.

-- CreateTable
CREATE TABLE "agents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Backfill: distinct, uppercased, trimmed agent names from customers (excluding the SELF sentinel).
INSERT INTO "agents" ("name", "createdAt", "updatedAt")
SELECT DISTINCT UPPER(TRIM("agentName")), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "customers"
WHERE "agentName" IS NOT NULL
  AND TRIM("agentName") <> ''
  AND UPPER(TRIM("agentName")) <> 'SELF';

-- CreateIndex
CREATE UNIQUE INDEX "agents_name_key" ON "agents"("name");
