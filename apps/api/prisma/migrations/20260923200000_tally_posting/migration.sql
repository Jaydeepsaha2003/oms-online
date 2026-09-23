-- Posting to Tally: who/when/why on the link, and a log of every attempt.
ALTER TABLE "tally_voucher" ADD COLUMN "postedBy" TEXT;
ALTER TABLE "tally_voucher" ADD COLUMN "postedAt" DATETIME;
ALTER TABLE "tally_voucher" ADD COLUMN "lastError" TEXT;
CREATE INDEX "tally_voucher_status_idx" ON "tally_voucher"("status");

CREATE TABLE "tally_post_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "challanId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "userName" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "outcome" TEXT,
    "requestXml" TEXT,
    "responseXml" TEXT,
    "error" TEXT
);
CREATE INDEX "tally_post_log_challanId_idx" ON "tally_post_log"("challanId");
