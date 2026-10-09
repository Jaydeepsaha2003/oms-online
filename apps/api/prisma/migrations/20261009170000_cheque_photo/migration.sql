-- A photo of the cheque, taken when it is recorded. Additive, empty for old cheques.
ALTER TABLE "cheques" ADD COLUMN "photoUrl" TEXT;
