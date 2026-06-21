-- Rebuild combinations as design-linked bundles. A combination is now a set of
-- designs; its cost/rate are computed live as the sum of the linked designs, so a
-- design cost change propagates automatically. Existing standalone combinations
-- are cleared (rebuilt from scratch via the new selection UI).

DROP TABLE "combinations";

CREATE TABLE "combinations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "combinations_code_key" ON "combinations"("code");

CREATE TABLE "combination_designs" (
    "combinationId" INTEGER NOT NULL,
    "designId" INTEGER NOT NULL,
    CONSTRAINT "combination_designs_combinationId_fkey" FOREIGN KEY ("combinationId") REFERENCES "combinations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "combination_designs_designId_fkey" FOREIGN KEY ("designId") REFERENCES "designs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("combinationId", "designId")
);
CREATE INDEX "combination_designs_designId_idx" ON "combination_designs"("designId");
