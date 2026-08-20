-- Special Commission: per-party / per-category / per-product / per-design
-- overrides of an agent's base commission rate.
--
-- Every narrowing column is nullable so one table expresses all five scopes, and
-- `scope` records which of them the rule was AIMED at — otherwise clearing a
-- column later would silently widen a rule instead of breaking it. Resolution
-- (most specific first, a party-specific rule outranking a general one) lives in
-- resolveCommissionRate() in @oms/shared, shared by the accrual engine and the
-- UI's rate tester so the two can never disagree.
--
-- Purely additive: no existing row changes, and with no rules in the table the
-- accrual engine resolves exactly the base rate it did before.

CREATE TABLE "agent_special_commissions" (
    "id"            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId"       INTEGER NOT NULL,
    "agentName"     TEXT    NOT NULL,
    "scope"         TEXT    NOT NULL,
    "customerId"    INTEGER,
    "customerName"  TEXT,
    "pCategory"     TEXT,
    "subCategory"   TEXT,
    "product"       TEXT,
    "designType"    TEXT,
    "basis"         TEXT    NOT NULL DEFAULT 'KGS',
    "ratePerUnit"   REAL    NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "note"          TEXT,
    "userName"      TEXT,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     DATETIME NOT NULL,
    CONSTRAINT "agent_special_commissions_agentId_fkey" FOREIGN KEY ("agentId")
        REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "agent_special_commissions_agentId_effectiveFrom_idx"
    ON "agent_special_commissions"("agentId", "effectiveFrom");
CREATE INDEX "agent_special_commissions_agentId_customerId_idx"
    ON "agent_special_commissions"("agentId", "customerId");

-- Which rule priced an accrual. Audit only; nothing computes from it. NULL on
-- every existing row, which reads correctly as "recorded before this was
-- tracked" — re-pricing fills it in.
ALTER TABLE "agent_commission_accruals" ADD COLUMN "rateNote" TEXT;
