-- Debit Note lines live in challan_items; keep the sale invoice each line refers to.
ALTER TABLE "challan_items" ADD COLUMN "refInvNo" TEXT;
