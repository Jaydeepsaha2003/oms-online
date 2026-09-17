-- Recognise a bank statement by its COLUMN PATTERN, not just by the bank name.
--
-- The saved mapping was keyed only on the bank name someone typed into the
-- upload box. That made it miss in the ordinary cases: a blank name put every
-- bank into one bucket that each upload overwrote, and "AXIS" vs "AXIS BANK"
-- were two different banks to the lookup.
--
-- The header row is a property of the file, so the same export recognises
-- itself whatever the name box says. Nullable with no backfill: existing
-- presets keep working by bank name and gain a fingerprint the next time that
-- bank is uploaded.
ALTER TABLE "bank_statement_column_preset" ADD COLUMN "columnsKey" TEXT;

CREATE INDEX "bank_statement_column_preset_columnsKey_idx" ON "bank_statement_column_preset"("columnsKey");
