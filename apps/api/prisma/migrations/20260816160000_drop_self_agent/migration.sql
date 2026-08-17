-- "SELF" is not an agent — remove it from the agent master.
--
-- A customer's `agentName` holds either a real agent's name or the sentinel
-- "SELF", which means the house sold to that party directly with nobody in
-- between. 98 parties carry it. The agents backfill (20260620140000_agents)
-- deliberately excluded it, but nothing stopped it being added afterwards
-- through the Agents screen or its Excel import, and it was.
--
-- Left there it is not merely cosmetic: an agent row is what commission accrues
-- to and settlements are paid against, so "SELF" turns every direct party into
-- commission payable to a fiction, and it clutters the agent picker on the
-- Settlement, Commission Rates and Covers screens.
--
-- Deleted only when nothing points at it, so this can never orphan money that
-- has already been recorded. If any of those tables do reference it the DELETE
-- matches no rows and the migration still succeeds — inspect the references and
-- reassign them to a real agent before re-running.

DELETE FROM "agents"
 WHERE UPPER(TRIM("name")) = 'SELF'
   AND NOT EXISTS (SELECT 1 FROM "agent_commission_rates"     WHERE "agentId" = "agents"."id")
   AND NOT EXISTS (SELECT 1 FROM "agent_commission_accruals"  WHERE "agentId" = "agents"."id")
   AND NOT EXISTS (SELECT 1 FROM "agent_settlements"          WHERE "agentId" = "agents"."id")
   AND NOT EXISTS (SELECT 1 FROM "agent_party_covers"         WHERE "agentId" = "agents"."id");
