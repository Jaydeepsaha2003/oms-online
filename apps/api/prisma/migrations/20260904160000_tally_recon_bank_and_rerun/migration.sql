-- Two additions to the Tally reconciliation.
--
-- 1) BANK MISMATCH. A receipt can agree on party, amount and date and still be
--    wrong: Tally banked it to one account and OMS to another. That reconciles
--    on paper and leaves two bank books disagreeing, so the comparison now
--    reports it as its own status and the row carries the OMS side's bank next
--    to the register's (which is already in `particulars`).
--
-- 2) RE-RUN WITHOUT RE-UPLOAD. Mapping an unmatched ledger to a customer used
--    to leave the report untouched, with the user told to upload the workbook
--    again. Storing the parsed register on the run lets the same comparison be
--    replayed in place.
--
--    The stored rows cannot substitute for it: an UNMATCHED_PARTY ledger — the
--    exact one being mapped — has no balance row, so the register's own opening
--    and closing for that party live nowhere else. A re-run rebuilt from rows
--    would compare its balance against zero and report every party as broken.
--
-- Both columns are nullable / defaulted with no backfill. Existing runs keep
-- their figures, and report canRerun = false so the screen keeps asking for a
-- re-upload rather than offering a button that cannot work.
ALTER TABLE "tally_recon_run" ADD COLUMN "bankMismatchCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tally_recon_run" ADD COLUMN "registerJson" TEXT;
ALTER TABLE "tally_recon_row" ADD COLUMN "omsBank" TEXT;
