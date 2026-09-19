-- A bag-booking line priced at the CURRENT price list instead of the booking's
-- frozen rates (bags still drawn from the booking). Defaults to false, so every
-- existing line keeps booking pricing exactly as before. Set/changed only by a
-- System Administrator (enforced in OrdersService.applyBookingPricing).
ALTER TABLE "order_items" ADD COLUMN "priceAtCurrent" BOOLEAN NOT NULL DEFAULT false;
