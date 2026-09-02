-- Withdrawing a dispatch overage from a bag booking.
--
-- WHY: dispatching more than an order line had pending is allowed (packing
-- variance), but a whole EXTRA BAG is not variance — it is stock leaving the
-- building against nothing. Where the party holds a bag booking, that extra is
-- what the booking is for, so it can now be withdrawn from it at the moment of
-- dispatch instead of leaving the booking untouched and the bag unaccounted.
--
-- Reuses booking_conversions rather than adding a second draw table: a draw is
-- a draw, one audit trail already renders on the booking PDF, and one shape
-- keeps recompute() the single place that decides what a booking has left.
--
-- `kind` separates the two: ORDER_LINE (keyed by orderItemId, the normal
-- convert/link path) vs DISPATCH_OVERAGE (keyed by dispatchId). Defaulted so
-- every existing row is an ORDER_LINE, which is what they all are.
--
-- `dispatchId` is UNIQUE so re-syncing a draw after the dispatch is edited
-- upserts one row instead of stacking a new draw per save. SQLite allows many
-- NULLs in a unique index, so every ORDER_LINE row coexists fine.
ALTER TABLE "booking_conversions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ORDER_LINE';
ALTER TABLE "booking_conversions" ADD COLUMN "dispatchId" INTEGER;
ALTER TABLE "booking_conversions" ADD COLUMN "pCategory" TEXT;
ALTER TABLE "booking_conversions" ADD COLUMN "note" TEXT;

CREATE UNIQUE INDEX "booking_conversions_dispatchId_key" ON "booking_conversions"("dispatchId");
