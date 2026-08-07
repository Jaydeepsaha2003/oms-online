-- Preclose: write off a PARTIALLY_CONVERTED booking's remaining qty and close it
-- for good, with the write-off amount + who/when/why kept for the record.
ALTER TABLE "bookings" ADD COLUMN "precloseBags" REAL;
ALTER TABLE "bookings" ADD COLUMN "precloseKgs" REAL;
ALTER TABLE "bookings" ADD COLUMN "precloseComment" TEXT;
ALTER TABLE "bookings" ADD COLUMN "precloseByName" TEXT;
ALTER TABLE "bookings" ADD COLUMN "precloseAt" DATETIME;
