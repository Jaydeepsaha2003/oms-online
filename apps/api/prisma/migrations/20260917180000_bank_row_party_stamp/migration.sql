-- Stamp WHEN a statement line's party was decided, and by whom.
--
-- Bank reconciliation is done in long sittings across dozens of lines, and the
-- screen had nothing to order that work by: the table could only be read in
-- statement order, so "what did I just assign" and "where did I stop" were
-- both unanswerable. partyAt gives both.
--
-- partyBy stays NULL for an automatic attribution on purpose. It is the flag
-- that separates a guess the matcher made from an answer a person gave, so the
-- screen can say "auto" rather than crediting a user who never saw the line.
--
-- Nullable with no backfill: rows assigned before this have no honest time to
-- claim, and inventing NOW() for them would date every old line to the
-- migration and ruin the sort it exists to serve. They read as blank until
-- next touched.
ALTER TABLE "bank_statement_row" ADD COLUMN "partyAt" DATETIME;
ALTER TABLE "bank_statement_row" ADD COLUMN "partyBy" TEXT;

-- Sorting is always inside one run, never across all of them.
CREATE INDEX "bank_statement_row_runId_partyAt_idx" ON "bank_statement_row"("runId", "partyAt");
