-- A design-type code can have many design names. Replace the unique-on-code
-- constraint with a unique-on-pair, so multiple names per code are allowed.
DROP INDEX "design_names_designType_key";
CREATE UNIQUE INDEX "design_names_designType_designName_key" ON "design_names"("designType", "designName");
CREATE INDEX "design_names_designType_idx" ON "design_names"("designType");
