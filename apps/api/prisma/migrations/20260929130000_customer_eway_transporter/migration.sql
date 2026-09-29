-- A party's own e-way bill transporter (name + GSTIN/TRANSIN), overriding the challan transporter's.
ALTER TABLE "customers" ADD COLUMN "ewayTransporter" TEXT;
ALTER TABLE "customers" ADD COLUMN "ewayTransporterGstin" TEXT;
