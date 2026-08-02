-- Legacy ids that were deleted in the app and must stay deleted across re-imports.
-- See the ImportTombstone model in schema.prisma for the full rationale.
CREATE TABLE "import_tombstones" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "legacyId" INTEGER NOT NULL,
    "reason" TEXT,
    "deletedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "import_tombstones_source_legacyId_key" ON "import_tombstones"("source", "legacyId");
CREATE INDEX "import_tombstones_source_idx" ON "import_tombstones"("source");

-- Seed from the audit log so deletions made BEFORE this table existed are honoured
-- on the very next import run. Without this, dispatches already deleted in the app
-- (e.g. DSP-04090 / DSP-04094) would be resurrected the next time Access is synced.
-- Fingerprints aren't recoverable for rows that are already gone, so these match on
-- legacy id alone — the same key the importer uses.
INSERT OR IGNORE INTO "import_tombstones" ("source", "legacyId", "reason", "deletedBy", "createdAt")
SELECT 'dispatch',
       CAST("resourceId" AS INTEGER),
       'seeded from audit log',
       "userEmail",
       MAX("createdAt")
FROM "audit_logs"
WHERE "action" = 'delete'
  AND LOWER("resource") = 'dispatch'
  AND "resourceId" IS NOT NULL
  AND CAST("resourceId" AS INTEGER) > 0
GROUP BY CAST("resourceId" AS INTEGER);

INSERT OR IGNORE INTO "import_tombstones" ("source", "legacyId", "reason", "deletedBy", "createdAt")
SELECT 'order',
       CAST("resourceId" AS INTEGER),
       'seeded from audit log',
       "userEmail",
       MAX("createdAt")
FROM "audit_logs"
WHERE "action" = 'delete'
  AND LOWER("resource") = 'order'
  AND "resourceId" IS NOT NULL
  AND CAST("resourceId" AS INTEGER) > 0
GROUP BY CAST("resourceId" AS INTEGER);
