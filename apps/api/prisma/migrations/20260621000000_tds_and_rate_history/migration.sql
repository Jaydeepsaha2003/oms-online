-- Customer TDS fields + rate-change history.

ALTER TABLE "customers" ADD COLUMN "tdsApplicable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "tdsPercent" REAL;

CREATE TABLE "rate_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT,
    "transportName" TEXT,
    "oldRate" INTEGER,
    "newRate" INTEGER,
    "changedByName" TEXT,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "rate_history_kind_customerName_category_idx" ON "rate_history"("kind", "customerName", "category");
CREATE INDEX "rate_history_changedAt_idx" ON "rate_history"("changedAt");
