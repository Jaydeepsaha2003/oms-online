-- Dispatch.designType is the legacy snapshot column used by dispatch/challan
-- screens as "Design Name". Normalize every linked row from the order line's
-- selected design name so historical records no longer mix names and type codes.
UPDATE "dispatches"
SET "designType" = COALESCE(
  (
    SELECT NULLIF(TRIM("order_items"."design"), '')
    FROM "order_items"
    WHERE "order_items"."id" = "dispatches"."orderItemId"
  ),
  'NA'
)
WHERE EXISTS (
  SELECT 1
  FROM "order_items"
  WHERE "order_items"."id" = "dispatches"."orderItemId"
);
