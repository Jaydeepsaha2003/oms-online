-- Rate List Settings: the default configuration, plus per-party overrides.
--
-- Spec sections 5, 9, 10 and 27. Purely additive: with no rows in this table the
-- rate list behaves exactly as it does today, because `emptyRateListConfig()`
-- includes every category and every sub-category. Nothing changes until somebody
-- configures something.
--
-- `payload` is JSON in TEXT. That is deliberate, not shortcut: the body is a
-- document (category list, sub-category picks, price combinations) always read
-- and written whole, never queried by its contents. The two columns that ARE
-- queried, `scope` and `customerId`, are real columns — and `scope` is stored
-- rather than inferred from `customerId IS NULL`, so clearing that column can
-- never silently turn a party row into the global default.

CREATE TABLE "rate_list_configs" (
    "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope"      TEXT    NOT NULL,
    "customerId" INTEGER,
    "payload"    TEXT    NOT NULL,
    "userName"   TEXT,
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  DATETIME NOT NULL
);

-- One configuration per party, and exactly one DEFAULT row (customerId NULL).
-- NOTE: in SQLite a UNIQUE index treats NULLs as distinct, so this constraint
-- does NOT stop a second DEFAULT row being inserted. The service enforces the
-- single-DEFAULT rule by upserting on scope='DEFAULT'; the index is here for the
-- per-party half, which it does enforce.
CREATE UNIQUE INDEX "rate_list_configs_scope_customerId_key"
    ON "rate_list_configs"("scope", "customerId");
