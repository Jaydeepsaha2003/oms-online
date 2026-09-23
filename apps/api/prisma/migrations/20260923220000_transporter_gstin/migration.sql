-- The e-way bill transporter ID (GSTIN / TRANSIN), sent on every Tally invoice.
ALTER TABLE "transporters" ADD COLUMN "gstin" TEXT;
