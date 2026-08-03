-- Add tcsPercent to Challan: the % `tcs` was computed at (Settings -> SCRAP TCS Rate),
-- so a challan's printed TCS line stays historically accurate even if the rate changes later.
ALTER TABLE "challans" ADD COLUMN "tcsPercent" REAL;
