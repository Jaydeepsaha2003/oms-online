-- First/last transaction a statement actually holds (its declared period can run
-- past the last entry, e.g. "To 30-09" with nothing after 29-09). New uploads
-- record it from every dated line; existing ones only kept their credit lines,
-- so they are backfilled from those — the best that is on record.
ALTER TABLE "bank_statement_run" ADD COLUMN "firstEntry" DATETIME;
ALTER TABLE "bank_statement_run" ADD COLUMN "lastEntry" DATETIME;
UPDATE "bank_statement_run" SET
  "firstEntry" = (SELECT MIN("txnDate") FROM "bank_statement_row" WHERE "runId" = "bank_statement_run"."id"),
  "lastEntry"  = (SELECT MAX("txnDate") FROM "bank_statement_row" WHERE "runId" = "bank_statement_run"."id");
