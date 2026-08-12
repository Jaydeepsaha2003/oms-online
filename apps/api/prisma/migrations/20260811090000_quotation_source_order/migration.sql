-- "Save as Quotation" park-and-reuse: link a quotation back to the DRAFT order
-- it was produced from, so converting the quotation revives that exact order
-- (same id / same Order #) instead of creating a duplicate next to it.
--
-- SQLite allows ADD COLUMN with a REFERENCES clause as long as the new column
-- is nullable with no default, which it is — so no table rebuild is needed and
-- existing rows are untouched (they simply get NULL: quotations created before
-- this change were never linked to an order).
ALTER TABLE "quotations" ADD COLUMN "sourceOrderId" INTEGER REFERENCES "orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One quotation per parked order, and one parked order per quotation.
CREATE UNIQUE INDEX "quotations_sourceOrderId_key" ON "quotations" ("sourceOrderId");
