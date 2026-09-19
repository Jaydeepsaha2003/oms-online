-- PNB COMBINED is a group under Sundry Debtors (as in Tally) holding both PNB ledgers.
UPDATE "account_groups"
SET "parentId" = (SELECT id FROM "account_groups" WHERE name = 'Sundry Debtors'),
    "isSubLedger" = true, "nettBalances" = true, "usedForCalc" = false, "allocMethod" = 'NOT_APPLICABLE'
WHERE "name" = 'PNB COMBINED';

UPDATE "customers"
SET "groupId" = (SELECT id FROM "account_groups" WHERE name = 'PNB COMBINED')
WHERE UPPER(TRIM("partyName")) IN ('PNB', 'PNB NE');