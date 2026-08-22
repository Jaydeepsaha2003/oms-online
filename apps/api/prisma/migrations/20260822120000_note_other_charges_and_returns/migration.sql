-- "Other Charges from Party" on both note tables.
--
-- Debit Notes live in `challans` and Credit Notes in `credit_notes`, so the
-- column has to exist on both for the shared note form to save either one.
-- Nullable with no default: an existing note has no such charge, and 0 would be
-- indistinguishable from "the user typed 0".
ALTER TABLE "challans" ADD COLUMN "otherCharges" REAL;
ALTER TABLE "credit_notes" ADD COLUMN "otherCharges" REAL;

-- Links a credit-note line to the reversing dispatch row it created when the
-- note was saved as "Undispatched". Null for every existing line, and for any
-- note saved as a plain credit note.
--
-- Held on the credit-note side (not on `dispatches`) so deleting a note can find
-- and remove exactly the reversals that note created, without scanning.
ALTER TABLE "credit_note_items" ADD COLUMN "returnDispatchId" INTEGER;
