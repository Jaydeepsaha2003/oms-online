-- The identity of a statement line across uploads, so a re-download can be
-- recognised without re-deriving it from every stored row.
--
-- Deliberately NOT unique: a party can pay the same amount twice on one day
-- with the same narration, and both are real. The duplicate check counts
-- occurrences instead of forbidding them.
--
-- Existing rows keep '' and are filled in by the application the first time
-- they are consulted (see backfillRowKeys) — SQLite has no regex replace, so
-- the squashing that builds the key cannot be done here.
ALTER TABLE "bank_statement_row" ADD COLUMN "rowKey" TEXT NOT NULL DEFAULT '';

CREATE INDEX "bank_statement_row_rowKey_idx" ON "bank_statement_row"("rowKey");
