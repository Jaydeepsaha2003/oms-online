# Bank statement reconciliation review — 21 September 2026

## Scope and method

Read-only review of the current bank-statement service, payment save/replay code, frontend recheck flow, and the local OMS database. Inspected all three saved bank workings and their receipt references. Called only the read-only receipt lookup method to verify an omission. Did not open the bank reconciliation page, because opening it automatically runs a mutating recheck. No receipts, statement records, or application code were changed.

This report separates current evidence from historical explanations. The database does not retain a complete before/after history of every reconciliation match, so it cannot prove the exact cause of every earlier popup.

## Main conclusion

The warning does not reliably mean money was deleted. The application conflates a lost match with a deleted receipt, then retains the deletion message even after the line matches again. There are also receipt-pool defects that can produce incorrect coverage and duplicate-posting risk.

## Current saved state

| Run | Bank / statement | State | Posted lines | Unmatched lines |
|---|---|---|---:|---:|
| 3 | Axis, file ending 27082026.csv | PROCESSED | 46 | 0 |
| 4 | ICICI, 01Apr2026_to_04Sep2026.csv | PROCESSED | 22 | 0 |
| 8 | Axis, file ending 17092026.csv | DRAFT | 13 | 22 |

All **81 currently POSTED lines have a ledger voucher with their posted reference**. This verifies existence, not necessarily the correct customer, amount, or bank.

There are **77 lines with deletion/reopening notes**:

- Run 3: 49 MATCHED and 5 PARTIAL (PARTIAL here means fully covered in aggregate).
- Run 4: 1 MATCHED.
- Run 8: 22 UNMATCHED.

Thus **55 already-covered lines retain obsolete deletion messages**. The 22 unmatched lines require receipt investigation; the stored wording does not establish deletion.

## Findings

### 1. High: a lost match is reported as a deleted receipt without checking deletion

`apps/api/src/bank-statement/bank-statement.service.ts:1573–1601`

After rematching a processed run, recheck collects every UNMATCHED line and labels it “The receipt this line was matched against was deleted”. It does not compare the previous receipt reference with the ledger, retain the previous match, or establish that the line was previously covered. If any posted receipt was missing, it also collects unmatched lines from an already-draft run, including potentially unrelated existing shortfalls.

Matches can change because a receipt is claimed by another statement, bank/date filters exclude it, allocations change, or matching logic changes. None of those proves deletion.

The popup repeats this unsupported diagnosis and says Process will recreate the receipts. Its assurance that nothing can be posted twice is too strong for the implementation.

### 2. High: obsolete deletion messages survive successful rematching

`apps/api/src/bank-statement/bank-statement.service.ts:819–830`

Rematch updates status, matched references and coverage, but leaves `note` unchanged. This directly explains the 55 covered lines retaining deletion warnings.

Examples from the earlier warning, verified in the current ledger:

| Run / row | Party | Amount | Existing receipt | Current status |
|---|---|---:|---|---|
| 3 / 298 | RANJITHAM METAL STORES | ₹25,200 | RN/605 | MATCHED |
| 3 / 301 | AMBIKA METAL | ₹37,852 | RN/608 | MATCHED |
| 3 / 306 | AARTI STEELS | ₹43,281 | RN/611 | MATCHED |
| 3 / 321 | CHAITANYA STAINLESS STEEL | ₹1,06,155 | RN/618 | MATCHED |

These receipts exist; the current “needs posting again” note is incorrect. Some original posted references really are absent: RN/720 and RN/722 are absent now. Absence of an old voucher still does not establish an uncovered bank credit: run 3 row 186 now matches another live receipt, RN/521 for ₹38,548.

### 3. High: advance-only receipts are missing from the matching pool

`apps/api/src/bank-statement/bank-statement.service.ts:839–925`

Despite its name, `receiptVouchers` starts from invoice allocation rows and only then looks up the ledger totals for the discovered receipt references. A receipt paid entirely on account has no invoice allocations and therefore never enters the pool.

The posted-receipt existence check already uses the ledger, which protects existing POSTED advance lines. The general matcher still misses those same receipts when matching an unposted statement line.

Concrete duplicate candidate: VINOD SALES, 22 July 2026, ₹22,109.

- RN/675 is a live Axis receipt entirely held as advance ADV-2026-0038, with no allocation rows.
- Run 3 row 421 is POSTED to RN/724, another live Axis receipt for the same party/date/amount. RN/724 remarks explicitly identify this statement line.
- Calling the actual receipt lookup returns RN/724's reference but omits RN/675.

This is strong evidence of a potential duplicate caused by the omission. Confirm against the original bank transfer and receipt history before reversing either voucher.

### 4. High: overlapping statements count the same aggregate receipt pool twice

`apps/api/src/bank-statement/bank-statement.service.ts:736–815`

Cross-run reservations include POSTED and single-reference MATCHED lines. They exclude aggregate PARTIAL coverage and partial coverage on UNMATCHED lines. Each run can therefore reuse the same remaining pool.

Confirmed current example: CHAITANYA STAINLESS STEEL.

- RN/677 ₹1,39,272 plus RN/661 ₹65,206 = **₹2,04,478** in live receipts.
- Run 3 rows 386, 423, 424, 425 claim that entire ₹2,04,478 pool.
- Run 8 rows 306, 329, 362 also claim ₹2,04,478 from those same two references (₹1,10,221 + ₹31,185 + ₹63,072).
- Total displayed coverage is **₹4,08,956 against ₹2,04,478 of receipts**.

This can hide a real shortfall. Conversely, reserving every candidate reference in an aggregate pool would remove too much money from other runs. The solution needs actual allocated amounts per receipt and statement line, rather than a comma-separated candidate list.

Source comments describe an earlier overly broad reservation rule causing 52 matches to disappear. This is consistent with the historical large popup, but comments alone are not an execution log proving that specific event.

### 5. Medium: the frontend can show stale rows after recheck changes the database

`apps/web/src/features/account/use-bank-statement.ts:148–156`

Recheck runs automatically when a saved working opens. The success handler refreshes cached data only if `reopened.length > 0`. It skips refresh when only `uncovered` changes, or when rematching changes verdicts without reopening. The popup can therefore describe new results while the table/counters still show old data. Failed checks are swallowed and a run is recorded as checked before the request succeeds.

### 6. High: Process relies on saved coverage and has no atomic duplicate guard

`apps/api/src/bank-statement/bank-statement.service.ts:1262–1384`

Process selects saved UNMATCHED rows and calculates `amount - matchedAmount` without refreshing against receipts entered since the last match. Payment creation and marking the statement row POSTED are separate operations. A stale match, concurrent request, or failure after payment creation but before row update can leave an existing receipt eligible to be posted again. This is a code-path risk; concurrent duplication was not exercised on live records.

### 7. Medium: bank and date scope can distort matching

The bank comparison deliberately strips account suffixes: Axis 0884 and Axis 8254 become the same institution. Blank-bank receipts are accepted for any bank. This cannot establish reconciliation to a specific bank account.

Receipt discovery is limited to the run's exact date range, although line matching allows a seven-day date difference. A receipt just beyond a range boundary is never considered. The aggregate pass has no per-line date tolerance and can use receipts from far apart within the range. These behaviors can change coverage without any deletion.

## Recommended correction order

1. Separate confirmed missing voucher, changed match, already-existing replacement receipt, and unresolved shortfall. Preserve old references and explain the actual reason. Clear obsolete generated notes when a line becomes covered.
2. Read bank receipts from the ledger, including advances, with explicit handling for agent receipts and legacy allocations. Refresh the frontend after every successful recheck.
3. Track actual receipt-to-statement allocated amounts across all workings so coverage is conserved.
4. Add a fresh posting check and an atomic/idempotent link between payment creation and statement posting.
5. Re-evaluate the saved workings with corrected logic, then review VINOD SALES RN/675 versus RN/724 and other duplicate candidates before changing accounting entries.

Do not use the current “reopened” popup alone as a reason to create receipts again. No accounting corrections or code fixes were performed as part of this report-first review.
