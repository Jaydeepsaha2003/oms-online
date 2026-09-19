# New Order audit — examples and verification guide

Companion to the [full audit](D:/oms-online/docs/audits/2026-09-19-new-order-validation-audit.md). Test numbers 1–9 match that report. Tests 10–14 cover its additional observations; R, L and B cover the comparison, old-code defects and business decisions.

**How to use this guide**

“Pass” describes the intended correct result. “Observed in audit” describes what happened during the original audit; it does not mean a repair has been made. A scenario marked **Source review only** is a proposed verification method, not a test already executed. Current results may differ if the application has since changed.

Use a **test copy of OMS with fake customers and items**. Most screen checks stop at Add or the save confirmation. Any test requiring saving, dispatching, deleting, changing master settings or damaging draft data belongs in that test copy. The developer scripts below create their own isolated data.

For each test, start with a fresh New Order. Select **Current price list** if a booking is offered, choose **SALES ORDER**, **NORMAL**, and completion days **7**, unless that test says otherwise. Do not carry rows from a previous test into the next one.

Record: **test number · date/build · tester · actual result · Pass / Fail / Could not test · screenshot or saved test order number**. “Could not reproduce” does not prove a timing-dependent or missing-configuration issue is fixed.

**Example data — have an administrator prepare this in the test copy**

These are example names, not customers or products assumed to exist in your OMS. You can substitute test records with the same settings.

| Record | Settings |
|---|---|
| AUDIT PARTY 1 | Active; agent SELF; category SALES. Product special-rate adjustment +₹10 for GLASS. Logos allowed. |
| AUDIT PARTY 2 | Active; agent SELF; category SALES. Product special-rate adjustment +₹50 for GLASS. Logos blocked for GLASS. |
| Item A: AUDIT GLASS | Category GLASS; subcategory PLAIN; size 7; 12 pieces per box; 0.25 kg per piece; base product rate ₹100. |
| Item B: OTHER GLASS | Category GLASS; subcategory PLAIN; size 8; 6 pieces per box; 0.5 kg per piece; base product rate ₹200. |
| LOGO option for Item A | Base design charge ₹5; no design special-rate adjustment. |
| Billing rule | GLASS is billed by KGS, except Test 2, which deliberately tests a missing rule. |

Do not configure an additional commission or bag-weight adjustment for these examples. For Party 1, plain Item A should show ₹110; for Party 2 it should show ₹150. Twelve pieces of Item A should calculate **3 kg and 1 box**. Confirm these starting values before testing. A different master setup will produce different expected numbers.

**TEST 1A — blank Product ₹**

Who: user, in the test copy. Previously reproduced in the browser and server audit.

1. Select AUDIT PARTY 1 and Item A. Enter Pcs **12**; confirm Kgs **3**.
2. Select all text in **Product ₹** and delete it. Leave the field empty; do not type zero.
3. Click **Add**.
4. If the row is added, inspect its rate and amount. To verify persistence, use the test copy only: Create order → Save only, then reopen that test order.

**Pass:** Add explains that the product price is missing and does not add the row. Final save also refuses a missing price if such a row reaches it.

**Observed in audit:** the row was added; the confirmed-save request contained a missing product rate and total rate **₹0**. This is different from intentionally entering ₹0 for an approved free sample.

**TEST 1B — negative Product ₹**

Who: user, in the test copy. Previously reproduced.

1. Start again with Party 1, Item A and Pcs **12**.
2. Paste **-5** into Product ₹. Pasting is important: a keyboard filter alone may block the minus key while still allowing pasted values.
3. Click Add and inspect the added row.

**Pass:** the form refuses the negative final product price. **Observed:** a row with Product ₹ **-5** was added. At 3 kg and no design charge, that implies an amount of **-₹15**. Negative discounts in Special Rates are permitted adjustments; this test is about the final charge becoming negative.

**TEST 1C — clearing Design ₹ locks the field**

Who: user. Previously reproduced.

1. Select Party 1 and Item A with LOGO. Confirm Design ₹ is **5** and editable.
2. Delete the **5** completely.
3. Try to type **8** in the same field without selecting the item again.

**Pass:** the field remains editable while entering a replacement; validation occurs when adding/saving. **Observed:** the empty Design ₹ field became disabled, so the user could not type the replacement. Keep booking pricing off for this test because booked rates are intentionally locked.

**TEST 2 — Size/Pcs display changes the billing calculation**

Who: administrator prepares missing configuration in a disposable test copy; user compares results. Previously reproduced with the billing rule absent.

1. Have the administrator remove/omit the GLASS billing-unit rule in the **test copy only**. If the settings screen cannot do this, use the isolated browser script; do not alter production configuration.
2. Start an order for Party 1. Find Item A by its size label, **7 AUDIT GLASS**. Enter Pcs **12**; Kgs should be **3**; rate should be **₹110**. Try Add and note the amount.
3. Start a separate order. Find the same item by **12 AUDIT GLASS**, its pieces label, or choose the Pcs display if available. Enter the same quantities and rate; try Add.

**Pass:** the missing billing rule produces a clear message, or an explicit authorized billing-unit choice. Merely changing how the item is found must not decide its billing unit.

**Failure example:** one route calculates **3 × ₹110 = ₹330**, while the other calculates **12 × ₹110 = ₹1,320**, with no deliberate change to the pricing basis. The audit reproduced the pieces route storing `PCS` when no category rule existed. If GLASS already has a valid KGS rule, this specific missing-rule failure will not reproduce.

**TEST 3 — quantities belong to the previous product**

Who: user. Previously reproduced.

1. Select Party 1, Item A, then enter Pcs **12**. Confirm **3 kg / 1 box**.
2. Before Add, change Item name to **8 OTHER GLASS**. Do not touch Pcs, Kgs or Box afterwards.
3. Inspect the quantities, then click Add.

**Pass:** the form either clears the old quantities and asks for new ones, or deliberately keeps 12 pieces and recalculates **6 kg / 2 boxes**. A manual weight override needs an explicit preservation rule.

**Observed:** the new item was added with **12 pieces / 3 kg / 1 box**, inherited from Item A, although its settings were 0.5 kg per piece and 6 pieces per box.

**TEST 4A — changing customer retains the first customer's rate**

Who: user. Previously reproduced.

1. Select Party 1, Item A, Pcs **12**, and click Add. Note its rate **₹110** and amount **₹330**.
2. Change Customer to Party 2 without removing the row.
3. Inspect the existing row. Select Item A again in the entry fields and compare the newly displayed price.

**Pass:** the form asks how to handle existing ordinary rows, or prevents the party change until they are resolved. It must make any intentional retention of an old price explicit.

**Observed:** the old row stayed **₹110**, while the newly selected item showed **₹150**. At 3 kg that is **₹330 versus ₹450** for the same item. This test does not authorize automatically repricing saved or booked orders.

**TEST 4B — a selected logo survives a switch to a customer who blocks it**

Who: user. Previously reproduced.
1. Select Party 1, choose Item A **with LOGO**, and enter Pcs **12**. Do not click Add yet.
2. Switch Customer to Party 2 and allow its details to finish loading.
3. Without choosing another item, click Add.

**Pass:** the selection is cleared or Add explains that this logo is not allowed for Party 2. **Observed:** the logo row could still be added for Party 2. The dropdown hiding an option is not enough if that option remains in the entry fields.

**TEST 5 — Add while the new customer's price is still loading**

Who: developer controls the delay; user can watch the form. Previously reproduced deterministically with a held response.

1. Load Party 1 and Item A; establish the **₹110** price.
2. In the isolated browser test, hold the special-rate response for Party 2 before it completes. Keep the item catalogue available.
3. Select Party 2, select Item A, enter Pcs **12**, then click Add while the response is still held.
4. Release the response; Party 2's correct price is **₹150**. Inspect the row already added.

**Pass:** Add waits for Party 2's required pricing/restrictions or clearly reports the loading/error state. **Observed:** Add accepted **₹110** while Party 2's request was pending. Search the browser-audit output for **“Add allowed while new customer price request pending”**.

A quick manual customer switch on a fast connection is not a reliable test of this case. Do not turn off the whole network: that tests a different situation.

**TEST 6 — server must reject incomplete or inconsistent orders**

Who: developer, using the existing **isolated server audit**. These are not instructions to type invalid data through ordinary dropdowns or send requests to live OMS.

Run `node scripts/audit-order-form-validation.cjs` from `D:\oms-online`. It creates a temporary database and fake customer, uses the actual request-validation and save code, prints results and removes the database afterwards. Each row below is a separate test, using a fresh order.

The valid starting order is AUDIT PARTY, order date **19-09-2026**, completion date **26-09-2026**, status CONFIRMED. Its item is 1 bag, 12 pieces, 70 kg, 1 box, ₹100 product rate, ₹0 design rate, KGS billing, NORMAL, SALES ORDER. Its amount is **₹7,000**. Change only the values described below.

| Test | Example / output name to find | Pass condition | Observed in audit |
|---|---|---|---|
| 6-00 | **Control: valid confirmed order** — leave the starting order unchanged | Saves at ₹7,000 with the correct customer and dates | Correctly accepted |
| 6-01 | **Confirmed order with no items** — send an empty item list | Reject a confirmed order with no items | Empty confirmed order saved |
| 6-02 | **Confirmed order with empty item object** — send one row containing no fields | Reject and identify missing line details | Blank row saved with rate 0 |
| 6-03 | **Unknown customer** — use UNKNOWN AUDIT PARTY, which is absent from the test master | Reject unknown customer for a new confirmed order | Saved with no customer ID |
| 6-04 | **Whitespace customer** — use three spaces as the name | Reject missing customer after trimming spaces | Saved with an empty name |
| 6-05 | **Negative ordinary quantities** — bags -1, pieces -12, kg -70 | Reject negative order quantities | Saved; amount −₹7,000 |
| 6-06 | **Zero billing quantity** — keep KGS billing, set kg to 0 | Reject a confirmed billable line with no billing quantity | Saved at amount 0 |
| 6-07 | **Non-numeric billing quantity** — send kg as the text `mistyped` | Reject the invalid number clearly | Changed to null and saved at amount 0 |
| 6-08 | **Missing product rate** — product rate missing, total rate 0 | Reject missing price | Saved at amount 0 |
| 6-09 | **Negative product rate** — product and total rate -100 | Reject negative effective price | Saved; amount −₹7,000 |
| 6-10 | **Total differs from product plus design** — product 100, design 20, total 1 | Derive total 120, or reject the contradiction; amount must be ₹8,400 if accepted | Saved total rate 1 and amount ₹70 |
| 6-11 | **Unknown product and design** — use MISSING PRODUCT and MISSING DESIGN | Reject invalid catalogue identity/design relationship | Saved both |
| 6-12 | **Missing priority, order type and billing unit** — send all three as null | Require or deliberately derive valid values for a confirmed line | Saved null fields |
| 6-13 | **Confirmed order without completion date** — omit due date | Reject missing commitment date on a confirmed order under the current form rule | Saved with no due date/days |
| 6-14 | **Completion date before order date** — due 01-09-2026, order 19-09-2026 | Reject the reversed dates | Saved the earlier due date and completion days 0 |
| 6-15 | **Malformed order date** — send `not-a-date` | Reject with a clear date-validation message before database work | Failed inside the database layer; not saved |
| 6-16 | **Unknown order status** — send NOT_A_STATUS | Reject unknown status | Saved NOT_A_STATUS |

**Reading results:** `ACCEPTED` means the test save completed. That is good for 6-00, but a failure for a case that should be rejected. `REJECTED` is not automatically a pass: 6-15 must have a clear validation error, not an internal database exception. Script exit code 0 means the audit ran, not that these safeguards passed.

**TEST 7 — changing only a comment must preserve the order header**

Who: developer, isolated server audit. Previously reproduced. Find **“Partial header edit”** in the output.

1. Create the valid starting order from Test 6. Record its customer, order date, due date and status.
2. Submit a partial update containing only `comment: "Only this should change"`.
3. Reload the order and compare all four recorded header fields.

**Pass:** only the comment changes. **Observed:** customer became empty, due date disappeared, status became PENDING and order date changed to the current instant. The normal New Order screen usually sends the whole header; a user editing a remark there may not trigger this particular partial-request defect.

**TEST 8A — cancellation rules must apply through every save route**

Who: developer, isolated data only. Previously reproduced. Find the two output entries beginning **“Control: dedicated status route…”** and **“General edit route…”**.

1. Create two independent copies of the valid Test 6 order. Against each, create a partial dispatch of **0.5 bag / 35 kg**.
2. On the first copy, request cancellation through the dedicated status operation.
3. On the second copy, send its full current order data through the general edit operation, changing status to CANCELLED.
4. Reload each order and count its dispatches.

**Pass:** both routes refuse cancellation under the same dispatched-order rule. **Observed:** the dedicated operation refused; the general edit accepted CANCELLED while one dispatch remained. Refusal in the normal Cancel button alone is not sufficient evidence that this is fixed.

**TEST 8B — shipped item identity must remain consistent**

Who: developer, isolated data only. Previously reproduced. Find **“Shipped line design name and category change”**.

1. Create the Test 6 order and dispatch **0.5 bag / 35 kg**.
2. Through the general update operation, change the line's design **name** from NA to DIFFERENT DESIGN and product category from GLASS to CUP. Keep design type, rates, size and quantities unchanged.
3. Reload the order and compare it with its dispatch.

**Pass:** the update refuses an unauthorized change to what was shipped. **Observed:** the new design name and category were saved. This deliberately tests design **name**, not design **type**, because the current guard checks one but misses the other. When repairing, also run each field change independently to verify both guards.

**TEST 8C — permanent deletion and dispatch history**

Who: developer in a disposable database, or administrator in a disposable test copy only. Previously reproduced. Find **“Shipped order deletion”**.

1. Create the Test 6 order and one partial dispatch. Record that the dispatch count is **1**.
2. Permanently delete that test order using an account permitted to delete.
3. Check whether its dispatch still exists.

**Observed:** dispatch count became **0** as well. This is a policy decision, not automatically a failed test: if deletion of shipped orders is forbidden, the server must refuse it; if it is explicitly allowed, the confirmation and audit record must clearly cover the dispatch history being deleted. The existing typed DELETE confirmation does not by itself settle this policy. **Never try this on a real dispatched or billed order.**

**TEST 9 — a second item is filled in but Add was not clicked**

Who: user, stop at the confirmation. Previously reproduced.

1. Select Party 1, Item A, Pcs **12**, then Add.
2. Select Item B and enter Pcs **24**. Leave it in the entry fields; do not click Add.
3. Click Create order and read the confirmation's item count.

**Pass:** the form asks whether to add or discard the unfinished second item before proceeding. **Observed:** the save dialog opened for **1 item** without a targeted warning about the second entry. Cancel the dialog after inspecting it.

Related draft check, not separately browser-tested in the audit: fill an unadded second entry, wait for autosave, reload the test page and inspect it. Current autosave stores the added list, not that entry. Decide whether the draft promise should cover it, or give an explicit warning before it is lost.

**TEST 10A — damaged or older draft data**

Who: developer, fresh disposable browser profile on the test app. **Source review only.**

1. Create a valid local New Order draft in that profile.
2. In browser storage, find `oms:order-draft-v1`. Change only its `items` value from a list into `{}`; keep valid JSON and a customer name.
3. Reload New Order.

**Pass:** the app safely ignores/quarantines the incompatible draft and offers recovery/reset without a blank or crashed form. **Failure predicted by source:** restore tries list operations such as `.some()` on a non-list. Save a copy of the test draft first and restore/remove only this test key afterwards; do not clear someone else's browser storage.

**TEST 10B — restored rows must be checked again before confirmation**

Who: developer in the same isolated profile. **Source review only** for this restore path; equivalent bad values were accepted by Test 6.

1. Create a valid local draft with one ordinary, unbooked row and completion days 7.
2. Change that row's saved `gram` to the string `"-3"`. Keep the rest of its shape valid.
3. Reload. Without editing/re-adding the row, try to confirm the order against the test API.

**Pass:** final validation identifies the bad row and blocks confirmation. **Failure predicted:** Add-time validation is skipped for the restored row. This simulates incompatible stored data; it is not a normal user typing path.

**TEST 11 — order date around midnight in India**

Who: developer controls browser time; user reads the displayed date. **Source review only** during the original audit.

1. Use a clean test profile with no restored draft. Set the test browser's timezone to Asia/Kolkata and its clock to **20-09-2026 at 02:00 AM** using browser-test clock controls.
2. Open a fresh New Order and inspect Order date.
3. Repeat at **20-09-2026 at 06:00 AM**.

**Pass:** both display **20-09-2026**. **Failure predicted:** the 02:00 case shows **19-09-2026**, because the helper takes the UTC date; the 06:00 case shows the correct day. Do not change the production computer/server clock or simply type a different order date—that would not test the default-date helper.

**TEST 12 — cancelled rows should not inflate the displayed total**

Who: administrator prepares a test order; user compares screens. **Source review only.**

1. Prepare an order with two KGS-billed rows: active row **3 kg × ₹100 = ₹300**, and cancelled row **2 kg × ₹100 = ₹200**. Cancel only the second line, not the whole order.
2. Open that order in the form used to add further items to an existing order.
3. Compare its footer/confirmation total with the order list or bill total.

**Pass:** every active-order total is **₹300**. The cancelled row may remain visible for history, but contributes zero. **Failure predicted:** the edit form totals **₹500**, while the server/bill totals **₹300**. If your role cannot prepare the cancellation, have a developer seed the isolated order; do not use a real order.

**TEST 13 — duplicate warning when only order type changes**

Who: user in test copy. **Source review only.**

1. Add Item A for Party 1 as **SALES ORDER**, Pcs 12, remark **AUDIT**.
2. Enter the same item/design/remark again but choose **SAMPLE ORDER**.
3. Click Add and read any duplicate warning.

**Difference predicted:** the new form warns even though the old duplicate definition included order type and would treat these as different combinations. **Pass depends on policy:** if different order types are intentionally separate, no misleading same-row warning; if warnings are desired, say clearly that the product repeats across different order types. This is an extra warning, not proof that a row is lost.

**TEST 14 — two catalogue records have the same displayed item name**

Who: administrator/developer prepares disposable catalogue records. **Source review only; no real-master collision scan was performed.**

1. In the test catalogue create two active products that both display as **7 AUDIT SHARED** with no design: one in category GLASS at ₹100, the other in CUP at ₹200. Ensure the catalogue genuinely contains both records.
2. Open New Order and search for **7 AUDIT SHARED**.
3. Count the choices and inspect which price/category can be selected.

**Pass:** both distinct records are selectable with enough category/size context to tell them apart, or the catalogue deliberately prevents creating ambiguous duplicates. **Failure predicted:** the form keeps only the first matching display label and silently hides the second identity. If the master itself refuses the setup, record that result rather than bypassing its rules on live data.

**R — examples for rules reported as preserved, improved or intentionally different**

These are regression checks, not additional claims that all manual steps below were executed. R13's linked booking cases are supported by the existing 25/25 isolated test run.

| Test | Simple verification method | Correct result / interpretation |
|---|---|---|
| R01 Existing selections | Type UNKNOWN PARTY into Customer, or an unknown item/design name, then leave the field without choosing a valid option | Invalid text is rejected/reverted with feedback; it does not become a new master identity |
| R02 Completion days | Add valid Item A; leave Com. days blank; try Create order. Separately try Save as Draft | Confirmed save asks for completion days; a draft may omit them |
| R03 At least one row | Select Party 1 and days 7, but add no rows; try Create order | No order is created; disabled action or clear “no items” message |
| R04 Design name | Prepare a test design with two allowed names. Select that designed item and quantities, leave Design Name blank, then Add | Must choose a name. A plain item with no names can use NA |
| R05 Special-rate priority | On a test party set product adjustments: category +10, subcategory +20, exact Item A +30. Base ₹100. Select Item A, then remove only the exact-item rule in test settings and select again | First ₹130; after removing exact-item rule ₹120; after removing subcategory rule ₹110. Rules are not all added together |
| R06 Total-rate sum | Choose a priced design; enter Product ₹100 and Design ₹5 | Total ₹105; at 3 kg amount ₹315. Also perform server Test 6-10 |
| R07 Numeric quantities | On a fresh ordinary entry, paste Bags -1 with otherwise valid values, then Add | Reject the negative quantity. Exact old numeric-key behaviour remains unknown without its helper |
| R08 Optional dimensions | For a KGS-billed ordinary item enter Kgs 3 with Bags/Pcs/Box blank; Add. Separately leave Kgs empty too and try Add | The 3 kg row can be added; the row missing its billing quantity is refused |
| R09 Duplicate warning across all rows | Add Item A, then Item B, then enter Item B again with the same design and remark; Add | Warning identifies the duplicate even though it is not the first row. Declining does not add another row |
| R10 Saved-row protection | Save a test order, reopen it in the New Order/add-more-items form | Existing saved rows are locked here; authorized changes belong in Order Modify. Newly added, unsaved rows remain editable |
| R11 Active item edit | Add Item A; click its Edit button; change Pcs; try Create order before Update item | Save asks to finish/cancel the edit. Update replaces the existing row rather than adding a second row |
| R12 Quantity calculation | Select Item A and enter Pcs 12; then enter Box 2 | First 3 kg / 1 box; after Box 2, 24 pieces / 6 kg. Test product-switch behaviour separately with Test 3 |
| R13 Booking capacity and linked dates | In test data book 10 bags/700 kg. Create one dated order drawing 3 bags/210 kg, then another dated order drawing 2 bags/140 kg. Try a further draw of 6 bags/420 kg | Two separate order numbers/dates stay linked to the booking; 5 bags/350 kg remain; the extra 6-bag draw is refused. Use the existing booking suite for wrong party, closed booking, per-category and concurrent-last-bag checks |
| R14 Reserve workflow replacement | In test data reserve bags before knowing the item; later choose that booking as the price source in two new dated orders | No need for a NO ITEM row in the normal order. Both orders draw from one booking, in line with your chosen new workflow |
| R15 Order numbering | In an isolated environment create two valid orders at the same time from separate sessions | Each receives its own order ID/code and rows; no collision or overwrite. Do not infer this solely from sequential saves |
| R16 Inactive customers | Create one active and one inactive fake customer. Open the New Order customer list | Under current policy only the active one is offered for a new order. This does not determine whether inactive parties appear in historical bank reconciliation |

For design-specific special rates, repeat R05 with a design base ₹5 and adjustments +1/+2/+3: most-specific gives ₹8, then ₹7, then ₹6. For combined designs, use the separate combination-pricing tests rather than assuming a single-design example covers them.

**L — examples explaining the old-code defects**

These require a working **old OMS test copy**, or a developer stepping through the supplied VB methods. They were source findings, not executed legacy-application tests. The uploaded three files alone do not supply the full project, database or helper functions.

| Test | Old-OMS example and method | What to verify |
|---|---|---|
| L01 Duplicate after first row | In the old grid add A first, B second, then try B again with identical design/type/remark | Source predicts the first nonmatching A causes early False, so B's duplicate can be missed. Correct traversal must examine every row |
| L02 Edit bypasses Add checks | Add a valid old-form row, choose Edit, clear a required field such as Product Rate, then click Update Item | Source predicts the edit copies the blank into the grid without rerunning Add checks. Correct Update uses the same required-field checks |
| L03 Reserve deducted before declined duplicate | Arrange the old test grid with Item A as its first product row and a NO ITEM reserve of 10 bags. Enter another identical Item A for 2 bags, choose a conversion date, then decline the duplicate confirmation | Record reserve before/after: it must remain 10 bags and no product row should be added. Source predicts reserve can drop to 8 before the user declines |
| L04 Amount sums rates | In the old test grid use two KGS rows: 3 kg at ₹100 and 2 kg at ₹200. Read the form's Amount summary | Correct calculated amount is ₹700; source predicts the summary adds the unit rates to show ₹300. This targets the form summary, not every old report |
| L05 All-zero quantities pass nonblank checks | Select an old-form product so quantities initialize to 0; fill other required values, then Add without entering any positive quantity | Source predicts zero passes the nonblank test. A confirmed billable line should require positive billing quantity. Exact key filtering is unverified |
| L06 Old header/date/unfinished-entry gaps | For customer-rate retention repeat 4A in old test OMS; for unfinished entry repeat 9. For date logic choose an order date, select completion days, then change the order date and check the due date again | These checks were not comprehensively enforced in the supplied Save routine. Check that rates remain deliberate, typed work is accounted for and due date remains consistent. Do not claim an old-runtime failure without running its full application |

**B — concrete examples for business rules that need your decision**

The expected answer must be agreed before these are treated as pass/fail tests.

| Decision | Example to try in a test copy | Decision to record |
|---|---|---|
| B01 Explicit zero charges | SALES ORDER: 3 kg with Product ₹0, versus SAMPLE ORDER: 3 kg with an intentionally free sample. Also try a completely blank rate using 1A | Which order types/roles may deliberately use zero? Blank still means missing, not an approved free rate |
| B02 Price after customer switch | Party 1's ₹110 row moved to Party 2, whose rate is ₹150, as in 4A | Should the form discard rows, offer repricing, or permit explicit retention? Saved/agreed booking prices must be treated separately |
| B03 Pieces must be whole | Enter Pcs 12.5 on a piece-billed item | Must pieces be whole numbers? Fractional bags, such as 0.5, are a separate and already needed case |
| B04 Weight precision and overrides | Enter actual Kgs 3.125 on a KGS-billed item at ₹100; expected unrounded multiplication is ₹312.50. Separately compare auto-derived weight with a deliberately entered actual weight | How many kg decimals should entry/calculation retain, and when may actual weight override the master estimate? |
| B05 Delete shipped orders | Use Test 8C only in disposable data | Is deletion forbidden after shipment, or allowed for a specified administrator with explicit history/accounting consequences? |

**Developer-run shortcuts and evidence**

The [server audit](D:/oms-online/scripts/audit-order-form-validation.cjs) covers Test 6, Test 7 and Test 8. The [browser audit](D:/oms-online/scripts/audit-order-form-ui.cjs) covers 1A, 1B, 2, 3, 4A, 4B, 5 and 9; run its separate design-rate case for 1C. Tests 10–14 and the manual R/L/B examples are proposed checks, unless otherwise stated.

In PowerShell on this workspace:

```powershell
Set-Location 'D:\oms-online'
node scripts/audit-order-form-validation.cjs

$env:PLAYWRIGHT_MODULE = 'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
Remove-Item Env:AUDIT_CASE -ErrorAction SilentlyContinue
node scripts/audit-order-form-ui.cjs

$env:AUDIT_CASE = 'design-rate'
node scripts/audit-order-form-ui.cjs
Remove-Item Env:AUDIT_CASE -ErrorAction SilentlyContinue

node scripts/test-booking-order-capacity.cjs
```

The browser-module path above is this machine's installed runtime; another machine may need its own installed Playwright path. The server/browser audit scripts print observations. The booking suite uses actual assertions. Keep that distinction when recording results.

For each repair, repeat its failing example and at least one valid control: valid prices still save; a permitted sample still works; fractional bags still work; actual weight remains editable where allowed; saved booking rates stay fixed; unrelated order fields and dispatch history remain intact. Finally, compare the reopened test order with the values shown before saving.
