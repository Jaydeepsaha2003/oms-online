-- Agreed rates on a bag booking, per size class.
--
-- A customer settles a price for a size ("6.5 cups at 62") when the booking is
-- made. Until now there was nowhere to put that: `customer_rates` holds a
-- customer-wide DELTA on the chart rate and always reads at its current value,
-- so it could neither express an absolute agreed price nor hold it still.
--
-- Keyed by category + sub-category because the sub-category already IS the size
-- class -- `4-PCS-CUP-FG` carries the size (6.5) and the pcs per box (4) -- so
-- this needs no new taxonomy and no backfill. Purely additive: bookings with no
-- rows here price exactly as they do today.
CREATE TABLE "booking_rates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bookingId" INTEGER NOT NULL,
    "pCategory" TEXT NOT NULL,
    "subCategory" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "userName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "booking_rates_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "booking_rates_bookingId_pCategory_subCategory_key" ON "booking_rates"("bookingId", "pCategory", "subCategory");
CREATE INDEX "booking_rates_bookingId_idx" ON "booking_rates"("bookingId");
