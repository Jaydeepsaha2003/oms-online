-- Group My Devices by the BROWSER, not by its address.
--
-- Sessions were grouped by parsed user-agent + IP, which is all the server
-- could see. The IP moves: this app is reached over the LAN by address, and
-- DHCP hands out a new one often enough that the same phone appeared as a new
-- device every few days -- which is what grew the list past being useful.
--
-- The client now mints a stable id into its own localStorage and sends it with
-- every request. Nullable with no backfill: sessions that predate this, and
-- browsers that cannot store one, keep the old browser+IP grouping.
ALTER TABLE "refresh_tokens" ADD COLUMN "deviceId" TEXT;

CREATE INDEX "refresh_tokens_deviceId_idx" ON "refresh_tokens"("deviceId");
