-- Order codes lose their zero padding: "ORD-01242" becomes "ORD-1242".
--
-- The code is generated from the row id and was padded to five digits, so every
-- four-digit order carried a leading zero that means nothing. Code generation is
-- changed alongside this, so NEW orders are already unpadded — this brings the
-- existing ones into line, otherwise the two forms would sit side by side
-- forever and the same order would print differently depending on its age.
--
-- The code is also SNAPSHOT into other tables when a record is created, so each
-- copy has to move with it or those references stop matching the order they name.
-- The columns below are every place in the database holding an "ORD-" string
-- (found by scanning every text column, not by reading the models).
--
-- Rewriting rule: take everything after "ORD-", cast through INTEGER to drop
-- leading zeros, and put it back. Rows already unpadded are left alone by the
-- WHERE clause, so this is safe to run more than once.

UPDATE "orders"
   SET "code" = 'ORD-' || CAST(CAST(SUBSTR("code", 5) AS INTEGER) AS TEXT)
 WHERE "code" LIKE 'ORD-0%';

UPDATE "dispatches"
   SET "orderCode" = 'ORD-' || CAST(CAST(SUBSTR("orderCode", 5) AS INTEGER) AS TEXT)
 WHERE "orderCode" LIKE 'ORD-0%';

UPDATE "followups"
   SET "orderCode" = 'ORD-' || CAST(CAST(SUBSTR("orderCode", 5) AS INTEGER) AS TEXT)
 WHERE "orderCode" LIKE 'ORD-0%';

UPDATE "followup_items"
   SET "orderCode" = 'ORD-' || CAST(CAST(SUBSTR("orderCode", 5) AS INTEGER) AS TEXT)
 WHERE "orderCode" LIKE 'ORD-0%';

UPDATE "booking_conversions"
   SET "orderCode" = 'ORD-' || CAST(CAST(SUBSTR("orderCode", 5) AS INTEGER) AS TEXT)
 WHERE "orderCode" LIKE 'ORD-0%';
