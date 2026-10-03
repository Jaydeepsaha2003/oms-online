-- "E-way bill mandatory" Yes/No on a party and on a transporter.
--
-- Tally asks for an e-way bill only above its threshold (50,000 / 1,00,000). A party (or a transporter) that needs one on every
-- bill gets it forced: OMS tells the person posting, sends the e-way details with the bill, and the Tally PC script lowers the
-- threshold for that one bill (F11) and puts it back. Additive only, default No.
ALTER TABLE "customers" ADD COLUMN "ewayMandatory" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "transporters" ADD COLUMN "ewayMandatory" BOOLEAN NOT NULL DEFAULT false;
