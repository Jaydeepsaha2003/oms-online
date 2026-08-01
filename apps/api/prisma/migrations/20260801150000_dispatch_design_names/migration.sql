-- Older dispatch snapshots copied the order line's design type into the Design
-- column. Backfill only those unchanged snapshots with the selected design name.
UPDATE "dispatches"
SET "designType" = (
  SELECT "order_items"."design"
  FROM "order_items"
  WHERE "order_items"."id" = "dispatches"."orderItemId"
)
WHERE EXISTS (
  SELECT 1
  FROM "order_items"
  WHERE "order_items"."id" = "dispatches"."orderItemId"
    AND TRIM(COALESCE("order_items"."design", '')) <> ''
    AND UPPER(TRIM("order_items"."design")) <> 'NA'
    AND UPPER(TRIM(COALESCE("dispatches"."designType", ''))) =
        UPPER(TRIM(COALESCE("order_items"."designType", '')))
);
