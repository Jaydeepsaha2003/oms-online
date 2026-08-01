-- Imported order lines used the legacy shape in which `design` held the type
-- suffix from productName and `designType` held the selected human-readable name.
-- Native rows use the modern shape (`design` is the selected name). Normalize
-- both layouts into the dispatch snapshot's Design Name column.
UPDATE "dispatches"
SET "designType" = (
  SELECT CASE
    WHEN TRIM(COALESCE("order_items"."design", '')) = '' THEN 'NA'
    WHEN UPPER(TRIM(COALESCE("order_items"."design", ''))) = 'NA' THEN 'NA'
    WHEN UPPER(TRIM(COALESCE("order_items"."productName", ''))) LIKE
         '% ' || UPPER(TRIM("order_items"."design"))
      THEN CASE
        WHEN TRIM(COALESCE("order_items"."designType", '')) = '' THEN 'NA'
        WHEN UPPER(TRIM("order_items"."designType")) = 'NA' THEN 'NA'
        ELSE TRIM("order_items"."designType")
      END
    ELSE TRIM("order_items"."design")
  END
  FROM "order_items"
  WHERE "order_items"."id" = "dispatches"."orderItemId"
)
WHERE EXISTS (
  SELECT 1
  FROM "order_items"
  WHERE "order_items"."id" = "dispatches"."orderItemId"
);
