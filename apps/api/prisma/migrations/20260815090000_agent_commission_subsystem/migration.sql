-- Agent commission, cheque bounce history & settlement.
--
-- Entirely additive: seven new tables plus six nullable columns on two existing
-- ones. No existing column is altered or dropped, so the running app keeps
-- working untouched until the new screens are built on top.

-- ── Links on existing tables ────────────────────────────────────────────────
-- SQLite allows ADD COLUMN with a REFERENCES clause while the new column is
-- nullable with no default, so no table rebuild is needed and existing rows
-- simply get NULL.

-- Which agent brought this cheque in (null = the party handed it over directly).
ALTER TABLE "cheques" ADD COLUMN "agentId" INTEGER REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cheques" ADD COLUMN "agentName" TEXT;
-- The bounced cheque this one replaces, so the chain stays walkable.
ALTER TABLE "cheques" ADD COLUMN "replacesChequeId" INTEGER REFERENCES "cheques" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "cheques_agentId_idx" ON "cheques" ("agentId");

-- A CRM promise made BY an agent, about a specific cheque.
ALTER TABLE "followups" ADD COLUMN "agentId" INTEGER;
ALTER TABLE "followups" ADD COLUMN "agentName" TEXT;
ALTER TABLE "followups" ADD COLUMN "chequeId" INTEGER REFERENCES "cheques" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "followups_agentId_idx" ON "followups" ("agentId");
CREATE INDEX "followups_chequeId_idx" ON "followups" ("chequeId");

-- ── Commission rate master ──────────────────────────────────────────────────
CREATE TABLE "agent_commission_rates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" INTEGER NOT NULL,
    "agentName" TEXT NOT NULL,
    "pCategory" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'KGS',
    "ratePerUnit" REAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "note" TEXT,
    "userName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "agent_commission_rates_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "agent_commission_rates_agentId_pCategory_effectiveFrom_idx" ON "agent_commission_rates" ("agentId", "pCategory", "effectiveFrom");

-- ── What each invoice earned ────────────────────────────────────────────────
CREATE TABLE "agent_commission_accruals" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" INTEGER NOT NULL,
    "agentName" TEXT NOT NULL,
    "challanId" INTEGER NOT NULL,
    "invNo" TEXT NOT NULL,
    "customerId" INTEGER,
    "customerName" TEXT NOT NULL,
    "pCategory" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'KGS',
    "qty" REAL NOT NULL,
    "kgs" REAL NOT NULL,
    "pcs" REAL NOT NULL DEFAULT 0,
    "ratePerUnit" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "invDate" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "agent_commission_accruals_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_commission_accruals_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "challans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_commission_accruals_challanId_pCategory_key" ON "agent_commission_accruals" ("challanId", "pCategory");
CREATE INDEX "agent_commission_accruals_agentId_idx" ON "agent_commission_accruals" ("agentId");
CREATE INDEX "agent_commission_accruals_invNo_idx" ON "agent_commission_accruals" ("invNo");

-- ── Agent covering a defaulting party (never touches the party ledger) ──────
CREATE TABLE "agent_party_covers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" INTEGER NOT NULL,
    "agentName" TEXT NOT NULL,
    "customerId" INTEGER,
    "customerName" TEXT NOT NULL,
    "invNo" TEXT,
    "amount" REAL NOT NULL,
    "mode" TEXT NOT NULL,
    "coveredAt" DATETIME NOT NULL,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "recoveredAt" DATETIME,
    "recoveredVia" TEXT,
    "userName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "agent_party_covers_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "agent_party_covers_agentId_idx" ON "agent_party_covers" ("agentId");
CREATE INDEX "agent_party_covers_customerId_idx" ON "agent_party_covers" ("customerId");
CREATE INDEX "agent_party_covers_status_idx" ON "agent_party_covers" ("status");

-- ── One row per actual bounce (unlimited per cheque) ────────────────────────
CREATE TABLE "cheque_bounce_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chequeId" INTEGER NOT NULL,
    "bounceDate" DATETIME NOT NULL,
    "bankName" TEXT,
    "charge" REAL NOT NULL DEFAULT 0,
    "gstPercent" REAL NOT NULL DEFAULT 0,
    "totalCharge" REAL NOT NULL DEFAULT 0,
    "reason" TEXT,
    "receiptUrl" TEXT,
    "receiptPath" TEXT,
    "userName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cheque_bounce_events_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cheque_bounce_events_chequeId_idx" ON "cheque_bounce_events" ("chequeId");
CREATE INDEX "cheque_bounce_events_bounceDate_idx" ON "cheque_bounce_events" ("bounceDate");

-- ── Bank-wise bounce charge ─────────────────────────────────────────────────
CREATE TABLE "bank_bounce_charges" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bankName" TEXT NOT NULL,
    "charge" REAL NOT NULL DEFAULT 0,
    "gstPercent" REAL NOT NULL DEFAULT 18,
    "userName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "bank_bounce_charges_bankName_key" ON "bank_bounce_charges" ("bankName");

-- ── Settlement ──────────────────────────────────────────────────────────────
CREATE TABLE "agent_settlements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "agentId" INTEGER NOT NULL,
    "agentName" TEXT NOT NULL,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "grossCommission" REAL NOT NULL DEFAULT 0,
    "bounceDeduction" REAL NOT NULL DEFAULT 0,
    "coverDeduction" REAL NOT NULL DEFAULT 0,
    "otherDeduction" REAL NOT NULL DEFAULT 0,
    "payMode" TEXT,
    "tdsPercent" REAL NOT NULL DEFAULT 0,
    "tdsAmount" REAL NOT NULL DEFAULT 0,
    "netPayable" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paidAt" DATETIME,
    "remarks" TEXT,
    "userName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "agent_settlements_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_settlements_code_key" ON "agent_settlements" ("code");
CREATE INDEX "agent_settlements_agentId_idx" ON "agent_settlements" ("agentId");
CREATE INDEX "agent_settlements_status_idx" ON "agent_settlements" ("status");

CREATE TABLE "agent_settlement_lines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "settlementId" INTEGER NOT NULL,
    "challanId" INTEGER,
    "invNo" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "pCategory" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'KGS',
    "qty" REAL NOT NULL,
    "baseRatePerUnit" REAL NOT NULL,
    "appliedRatePerUnit" REAL NOT NULL,
    "paidRatio" REAL NOT NULL DEFAULT 0,
    "invoiceAmount" REAL NOT NULL DEFAULT 0,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL DEFAULT 0,
    "isTopUp" BOOLEAN NOT NULL DEFAULT false,
    "priorSettledRatio" REAL NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_settlement_lines_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "agent_settlements" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "agent_settlement_lines_settlementId_idx" ON "agent_settlement_lines" ("settlementId");

CREATE TABLE "agent_settlement_deductions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "settlementId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "bounceEventId" INTEGER,
    "coverId" INTEGER,
    "chequeNo" TEXT,
    "bankName" TEXT,
    "refDate" DATETIME,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_settlement_deductions_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "agent_settlements" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "agent_settlement_deductions_settlementId_idx" ON "agent_settlement_deductions" ("settlementId");
