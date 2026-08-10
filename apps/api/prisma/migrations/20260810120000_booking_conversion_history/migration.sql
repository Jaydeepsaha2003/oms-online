-- BookingConversion becomes a durable audit trail instead of a delete/recreate
-- cache: recompute() now upserts by orderItemId (hence the unique constraint)
-- and marks a row removed instead of deleting it, so a booking-drawn line's
-- usage survives even if the underlying order line is later hard-deleted.
ALTER TABLE "booking_conversions" ADD COLUMN "orderId" INTEGER;
ALTER TABLE "booking_conversions" ADD COLUMN "orderCode" TEXT;
ALTER TABLE "booking_conversions" ADD COLUMN "orderDate" DATETIME;
ALTER TABLE "booking_conversions" ADD COLUMN "removedAt" DATETIME;
ALTER TABLE "booking_conversions" ADD COLUMN "removedReason" TEXT;
ALTER TABLE "booking_conversions" ADD COLUMN "removedByName" TEXT;

CREATE UNIQUE INDEX "booking_conversions_orderItemId_key" ON "booking_conversions"("orderItemId");
