-- Per-line-item order type.
ALTER TABLE "order_items" ADD COLUMN "ordType" TEXT;

-- User-editable option lists (Settings page): completion-days, order types, …
CREATE TABLE "order_options" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "group" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "order_options_group_value_key" ON "order_options"("group", "value");
CREATE INDEX "order_options_group_idx" ON "order_options"("group");

-- Seed sensible defaults.
INSERT INTO "order_options" ("group", "value", "sortOrder", "updatedAt") VALUES ('COMPLETION_DAYS', '3', 0, CURRENT_TIMESTAMP);
INSERT INTO "order_options" ("group", "value", "sortOrder", "updatedAt") VALUES ('COMPLETION_DAYS', '5', 1, CURRENT_TIMESTAMP);
INSERT INTO "order_options" ("group", "value", "sortOrder", "updatedAt") VALUES ('COMPLETION_DAYS', '7', 2, CURRENT_TIMESTAMP);
INSERT INTO "order_options" ("group", "value", "sortOrder", "updatedAt") VALUES ('COMPLETION_DAYS', '10', 3, CURRENT_TIMESTAMP);
INSERT INTO "order_options" ("group", "value", "sortOrder", "updatedAt") VALUES ('COMPLETION_DAYS', '15', 4, CURRENT_TIMESTAMP);
INSERT INTO "order_options" ("group", "value", "sortOrder", "updatedAt") VALUES ('COMPLETION_DAYS', '30', 5, CURRENT_TIMESTAMP);
INSERT INTO "order_options" ("group", "value", "sortOrder", "updatedAt") VALUES ('ORDER_TYPE', 'SALES ORDER', 0, CURRENT_TIMESTAMP);
INSERT INTO "order_options" ("group", "value", "sortOrder", "updatedAt") VALUES ('ORDER_TYPE', 'SAMPLE ORDER', 1, CURRENT_TIMESTAMP);
