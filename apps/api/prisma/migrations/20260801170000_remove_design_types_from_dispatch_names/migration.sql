-- A legacy order line often stored its design type in both `design` and
-- `designType`. That is not a recorded Design Name, so expose it consistently as
-- NA rather than mixing type codes with genuine selected names.
UPDATE "dispatches"
SET "designType" = CASE
  WHEN TRIM(COALESCE("order_items"."design", '')) = '' THEN 'NA'
  WHEN UPPER(TRIM("order_items"."design")) = UPPER(TRIM(COALESCE("order_items"."designType", ''))) THEN 'NA'
  ELSE TRIM("order_items"."design")
END
FROM "order_items"
WHERE "order_items"."id" = "dispatches"."orderItemId";
