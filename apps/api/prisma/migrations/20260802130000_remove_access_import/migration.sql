-- The MS Access connector has been removed: SQLite is now the single source of
-- truth and nothing imports legacy rows any more.
--
-- import_tombstones existed only to stop that insert-only, legacy-id-keyed
-- importer from resurrecting records deleted in the app. With no importer there
-- is nothing left to resurrect them, so the table has no remaining purpose.
DROP TABLE IF EXISTS "import_tombstones";

-- Config keys that pointed at the persisted .accdb and recorded the last sync.
DELETE FROM "app_config"
WHERE "key" IN ('ACCESS_IMPORT_FILE_PATH', 'ACCESS_IMPORT_LAST_SYNC');
