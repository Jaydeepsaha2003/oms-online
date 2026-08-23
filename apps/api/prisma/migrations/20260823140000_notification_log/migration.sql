-- Records every notification sent, per recipient, so a repeat can be recognised
-- and skipped. Purely additive: no existing table or row is touched.
CREATE TABLE "notification_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dedupeKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "notification_log_dedupeKey_userId_sentAt_idx" ON "notification_log"("dedupeKey", "userId", "sentAt");
CREATE INDEX "notification_log_sentAt_idx" ON "notification_log"("sentAt");
