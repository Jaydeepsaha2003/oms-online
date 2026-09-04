-- Dispatch hold on a party: while held, no NEW dispatch may be recorded for it.
--
-- WHY a new flag rather than reusing `active`: the two say different things and
-- are needed at the same time. `active = false` means "we no longer deal with
-- this party" — it is hidden from every picker, so its orders become hard to
-- even find. A hold is temporary and deliberate: the party stays in every
-- dropdown, keeps taking orders, and its already-shipped goods stay billable
-- and returnable. The only thing it cannot do is ship again. Setting a party
-- inactive to stop its shipments would have hidden the orders that are exactly
-- what somebody needs to look at while the hold is on.
--
-- The reason and the two audit columns are not decoration. The block lands on
-- whoever is standing at the Dispatch Order screen, and a bare refusal leaves
-- them with nothing to act on and nobody to ask — so the hold carries why it
-- was placed, by whom, and when, and the dispatch screen shows all three.
--
-- Defaulting to 0 with no backfill: every existing party is un-held, so this
-- changes nothing until somebody places a hold.
ALTER TABLE "customers" ADD COLUMN "dispatchHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "dispatchHoldReason" TEXT;
ALTER TABLE "customers" ADD COLUMN "dispatchHoldBy" TEXT;
ALTER TABLE "customers" ADD COLUMN "dispatchHoldAt" DATETIME;

-- The Customers master filters by hold ("show me every party on hold") and the
-- Dispatch Order page resolves the hold for a page of pending lines by customer
-- id. Both read the flag, never the reason.
CREATE INDEX "customers_dispatchHold_idx" ON "customers"("dispatchHold");
