-- Tally account groups (Masters -> Group) and each customer's "Under" group.
CREATE TABLE "account_groups" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "parentId" INTEGER,
    "isSubLedger" BOOLEAN NOT NULL DEFAULT false,
    "nettBalances" BOOLEAN NOT NULL DEFAULT false,
    "usedForCalc" BOOLEAN NOT NULL DEFAULT false,
    "allocMethod" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_groups_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "account_groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_groups_name_key" ON "account_groups"("name");

-- Primary groups.
INSERT INTO "account_groups" ("name", "isSystem") VALUES
  ('Branch / Divisions', true),
  ('Capital Account', true),
  ('Current Assets', true),
  ('Current Liabilities', true),
  ('Direct Expenses', true),
  ('Direct Incomes', true),
  ('Fixed Assets', true),
  ('Indirect Expenses', true),
  ('Indirect Incomes', true),
  ('Investments', true),
  ('Loans (Liability)', true),
  ('Misc. Expenses (ASSET)', true),
  ('PNB COMBINED', true),
  ('Purchase Accounts', true),
  ('Sales Accounts', true),
  ('Suspense A/c', true);

-- Sub-groups, under their Tally parent.
INSERT INTO "account_groups" ("name", "parentId", "isSystem")
SELECT c.name, (SELECT id FROM "account_groups" WHERE name = c.parent), true FROM (
  SELECT 'Bank OD A/c' AS name, 'Loans (Liability)' AS parent
  UNION ALL SELECT 'Deposits (Asset)', 'Current Assets'
  UNION ALL SELECT 'Duties & Taxes', 'Current Liabilities'
  UNION ALL SELECT 'Loans & Advances (Asset)', 'Current Assets'
  UNION ALL SELECT 'Provisions', 'Current Liabilities'
  UNION ALL SELECT 'Reserves & Surplus', 'Capital Account'
  UNION ALL SELECT 'Secured Loans', 'Loans (Liability)'
  UNION ALL SELECT 'Stock-in-Hand', 'Current Assets'
  UNION ALL SELECT 'Sundry Creditors', 'Current Liabilities'
  UNION ALL SELECT 'Sundry Debtors', 'Current Assets'
  UNION ALL SELECT 'Unsecured Loans', 'Loans (Liability)'
) c;

-- Sundry Debtors settings as set in Tally.
UPDATE "account_groups" SET "isSubLedger" = true, "nettBalances" = true WHERE "name" = 'Sundry Debtors';

ALTER TABLE "customers" ADD COLUMN "groupId" INTEGER REFERENCES "account_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "customers" SET "groupId" = (SELECT id FROM "account_groups" WHERE name = 'Sundry Debtors');