-- Legacy (Access-imported) RECEIPT vouchers cannot be edited or deleted: the
-- edit/replay machinery (loadReplayChain in payments.service.ts) refuses any
-- voucher whose adjMode is NULL, because it has no way to know how to safely
-- redo its allocation. adjMode was added by 20260807194403_payment_edit_support
-- with no backfill, so every RECEIPT voucher saved before that migration —
-- which is every one imported from Access, 521 of 577 total on this database —
-- is permanently blocked from being touched.
--
-- This backfills adjMode, plus receiptRefId / advanceRefId / selectedInvNos
-- (which the replay also needs), from data that already exists: the
-- allocation rows each voucher itself created, still linked via
-- `acct_payment_receipt.refRecId` / `acct_party_advance.refRecId` equalling
-- the voucher's own `voucherNo` (see the reverseChain comment in
-- payments.service.ts for why that linkage is exact and collision-free).
--
-- Verified against the full dataset before writing this migration — every one
-- of the 521 legacy RECEIPT vouchers resolves with NO ambiguity:
--   - 517 have every one of their allocation lines agree on ONE modeOfAdj
--     (457 AUTOMATIC, 60 AGST REF) — legacy Access already used this exact
--     ADVANCE / AGST REF / AUTOMATIC vocabulary (its own MODE OF ADJ column),
--     so this is read straight off the original data, not inferred.
--   - 3 have no allocation lines at all but parked their full amount as an
--     advance — adjMode = ADVANCE (skip invoice allocation entirely) is
--     exactly what that already means.
--   - 1 (RN/437) has no allocation or advance rows, only an opening-balance
--     CLEARANCE for its full amount — opening clearance happens unconditionally
--     before the adjMode branch even runs, so AUTOMATIC (the only mode that
--     changes nothing about that step) is the correct, not merely default,
--     choice.
-- No voucher had conflicting/mixed signals, so nothing here is a guess. Any
-- voucher that still has no unambiguous signal is deliberately left
-- adjMode = NULL — exactly as blocked as it is today — rather than guessed
-- at; a defensive migration should never assume its own analysis covers every
-- row that could ever exist.
--
-- receiptRefId / advanceRefId are backfilled the same way (517 vouchers have
-- exactly one linked receipt refId; a separate 24 have exactly one linked
-- advance refId — the two aren't mutually exclusive, a voucher can have both)
-- so editing a legacy voucher reuses its ORIGINAL Access-era REC-/ADV- id
-- instead of silently minting a new one the first time it's touched.
--
-- selectedInvNos is backfilled for the 60 AGST REF vouchers specifically —
-- runWaterfall requires it whenever adjMode = 'AGST REF', and it is the only
-- other field that mode reads. AUTOMATIC/ADVANCE vouchers never look at it.

-- 1) adjMode from a single consistent modeOfAdj across the voucher's own
--    allocations. IS NOT NULL on the inner SELECT guards against ever picking
--    a NULL over a real value if a voucher had one blank allocation line mixed
--    with one real one (COUNT(DISTINCT) already ignores NULLs, so this keeps
--    the outer condition and the picked value consistent with each other).
UPDATE acct_ledger
SET adjMode = (
  SELECT modeOfAdj FROM acct_payment_receipt
  WHERE refRecId = acct_ledger.voucherNo AND modeOfAdj IS NOT NULL
  LIMIT 1
)
WHERE voucherType = 'RECEIPT' AND adjMode IS NULL
  AND (SELECT COUNT(DISTINCT modeOfAdj) FROM acct_payment_receipt WHERE refRecId = acct_ledger.voucherNo) = 1;

-- 2) No allocation lines, but the full amount was parked as an advance.
UPDATE acct_ledger
SET adjMode = 'ADVANCE'
WHERE voucherType = 'RECEIPT' AND adjMode IS NULL
  AND NOT EXISTS (SELECT 1 FROM acct_payment_receipt WHERE refRecId = acct_ledger.voucherNo)
  AND EXISTS (SELECT 1 FROM acct_party_advance WHERE refRecId = acct_ledger.voucherNo);

-- 3) No allocation or advance rows, only an opening-balance clearance.
UPDATE acct_ledger
SET adjMode = 'AUTOMATIC'
WHERE voucherType = 'RECEIPT' AND adjMode IS NULL
  AND NOT EXISTS (SELECT 1 FROM acct_payment_receipt WHERE refRecId = acct_ledger.voucherNo)
  AND NOT EXISTS (SELECT 1 FROM acct_party_advance WHERE refRecId = acct_ledger.voucherNo)
  AND EXISTS (SELECT 1 FROM acct_opening_trans WHERE refRecId = acct_ledger.voucherNo AND kind = 'CLEARANCE');

-- 4) receiptRefId: reuse the original id instead of minting a new one on first edit.
UPDATE acct_ledger
SET receiptRefId = (SELECT refId FROM acct_payment_receipt WHERE refRecId = acct_ledger.voucherNo LIMIT 1)
WHERE voucherType = 'RECEIPT' AND receiptRefId IS NULL
  AND (SELECT COUNT(DISTINCT refId) FROM acct_payment_receipt WHERE refRecId = acct_ledger.voucherNo) = 1;

-- 5) advanceRefId, same idea.
UPDATE acct_ledger
SET advanceRefId = (SELECT refId FROM acct_party_advance WHERE refRecId = acct_ledger.voucherNo LIMIT 1)
WHERE voucherType = 'RECEIPT' AND advanceRefId IS NULL
  AND (SELECT COUNT(DISTINCT refId) FROM acct_party_advance WHERE refRecId = acct_ledger.voucherNo) = 1;

-- 6) selectedInvNos for AGST REF vouchers — the invoices this voucher's own
--    allocation rows actually cover, in the order they were originally created.
--    Runs after (1), which is what makes adjMode = 'AGST REF' available here.
UPDATE acct_ledger
SET selectedInvNos = (
  SELECT json_group_array(invNo) FROM (
    SELECT invNo FROM acct_payment_receipt WHERE refRecId = acct_ledger.voucherNo ORDER BY id
  )
)
WHERE voucherType = 'RECEIPT' AND adjMode = 'AGST REF' AND selectedInvNos IS NULL;
