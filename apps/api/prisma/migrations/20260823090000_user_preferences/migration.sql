-- Per-user settings that belong to the person rather than the installation.
--
-- Key/value on purpose: a new preference then needs no further migration. First
-- use is reminder Do-Not-Disturb hours, which cannot live in the app-wide CRM
-- settings (a shop owner and a floor operator want different quiet windows).
--
-- Cascades with the user: a deleted account leaves no orphan preferences.
CREATE TABLE "user_preferences" (
    "id"        INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId"    TEXT     NOT NULL,
    "key"       TEXT     NOT NULL,
    "value"     TEXT     NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_preferences_userId_key_key" ON "user_preferences"("userId", "key");
CREATE INDEX "user_preferences_userId_idx" ON "user_preferences"("userId");
