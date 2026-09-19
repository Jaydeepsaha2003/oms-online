# Old OMS → New OMS: New Order validation audit

Audited 19 September 2026 against local source at commit `4c19f53`.

**Conclusion: your concern is justified. There are confirmed gaps that can change prices, quantities and saved order details. Several are visible in ordinary form use; others are missing server protections. The booking feature itself has substantially stronger checks than ordinary order entry.**

This is an audit, not a repair. No application code or real order/customer records were changed. The added audit scripts use fake parties and a temporary database/local fixture server.

**Verify each point:** the [user test guide](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md) supplies example data, numbered steps, pass/fail results and the original observations. Each finding below links to its matching test. Screen checks, developer-only checks and unexecuted source-review examples are labelled separately.

**Evidence and scope**

- Compared [Form8.vb.txt](D:/OneDrive/Desktop/Form8.vb.txt), [Form8.Designer.vb.txt](D:/OneDrive/Desktop/Form8.Designer.vb.txt) and [Form8.resx](D:/OneDrive/Desktop/Form8.resx) with the current New Order form, shared controls, pricing hooks, order DTO, server create/update logic, schema and booking protections.
- Exercised **9 browser scenarios** using the actual React form with local fixture responses. These reproduced the UI issues below. The main eight-scenario run reported no browser runtime errors; logical validation failures still occurred.
- Ran **22 server probes** through the actual Nest validation pipe and OrdersService against a disposable SQLite database. The results below distinguish accepted bad input from valid rejection.
- Ran the existing isolated booking suite: **25/25 passed**.
- The old files are not a complete runnable VB project. Helpers including `CheckNum`, `MkCon`, `ReadData`, `GetDataFromTable`, `GetMaxNo`, `addIteminCombo` and `checkwithmsg` are external. Their internals cannot be certified from these attachments. The `.resx` contains the form icon and Order ID locking metadata, not additional business-validation code.
- This does not establish whether existing production records are already affected. No live-data scan, migration or correction was performed.

**1. High priority — missing or negative prices can be added and saved**

Try it: [Test 1A — blank product rate](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:30), [1B — negative rate](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:43), [1C — design field locks](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:53).

The old normal-item Add routine explicitly required `PRODUCT RATE`, `RATE` and the other listed fields to be nonblank. The new Add routine checks quantities but does not validate the product/design rates. Its rate helper treats blank as zero.

Browser reproduction: choose a valid item, enter 12 pieces, clear Product ₹, Add, then Create order → Save only. The captured request contained `productRate: null`, `rate: 0`, `pcs: 12`, `gram: 3` and `status: CONFIRMED`. Entering `-5` in Product ₹ also added a row. The server separately accepted missing and negative prices.

There is a related design-rate regression: choose an item with a ₹5 design charge, then clear Design ₹. The field becomes disabled immediately, so the user cannot type the replacement. The browser confirmed it changed from enabled to disabled with an empty value. The old enable/disable decision used the selected design's base rate, rather than the value being edited.

Repair: reject missing/nonfinite/negative effective rates on Add, Update item and final save, with the same server checks. Keep a permitted rate field editable while its value is being entered. **Do not automatically forbid an explicit zero charge**: sample/free-order policy needs to be distinguished from a missing price. Negative special-rate adjustments are also different from a negative final charge.

Evidence: [old required fields](D:/OneDrive/Desktop/Form8.vb.txt:939), [old design-rate enable rule](D:/OneDrive/Desktop/Form8.vb.txt:794), [new rate conversion](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:206), [new Add validation](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1647), [new design-rate enable rule](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1572), [server rate handling](D:/oms-online/apps/api/src/orders/orders.service.ts:1382).

**2. High priority — a display choice can decide whether the item is billed by kg or pieces**

Try it: [Test 2 — compare ₹330 with ₹1,320 for the same quantities](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:63).

The old form fetched `CAL FIELD` from `PRICECAL` for the category, and refused Add if that field was blank. The new form silently substitutes the Size/Pcs display choice when no category billing rule exists.

Browser reproduction with the category rule omitted: the same glass, 12 pieces weighing 3 kg, was added with `calField: PCS` after searching by its 12-piece label. At ₹110, multiplying by pieces gives ₹1,320; multiplying by kg gives ₹330. The difference comes from the fallback, not a deliberate pricing-unit decision.

Repair: require a configured billing unit, or require an explicit authorized choice that is independent of item search/display mode. The server should validate the billing unit against the category rule. Existing historical lines need their saved unit preserved unless deliberately corrected.

Evidence: [old PRICECAL lookup](D:/OneDrive/Desktop/Form8.vb.txt:792), [old CAL FIELD requirement](D:/OneDrive/Desktop/Form8.vb.txt:939), [new fallback](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1683).

**3. High priority — changing the selected product keeps quantities calculated for the previous product**

Try it: [Test 3 — change from Item A to Item B before Add](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:75).

The old `GetSpecialRate()` reset Bags, Pcs, Kgs and Box to zero after product selection. The new `onItemPick()` replaces product metadata but spreads the previous entry, retaining its quantities.

Browser reproduction:

| State | Pieces | Kg | Boxes |
|---|---:|---:|---:|
| First item: 0.25 kg/piece, 12 pieces/box | 12 | 3 | 1 |
| New item: 0.5 kg/piece, 6 pieces/box; values actually added | 12 | 3 | 1 |
| Values calculated from the new item's settings | 12 | 6 | 2 |

Repair: reset dependent quantities when the actual product changes, or preserve the user's driving quantity and visibly recalculate dependent fields. Preserve deliberate weight overrides only through an explicit policy; a blanket equality rule would reject legitimate actual weights.

Evidence: [old reset](D:/OneDrive/Desktop/Form8.vb.txt:795), [new product selection](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1343), [new quantity calculations](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1492).

**4. High priority — customer changes leave old prices and selected logo items behind**

Try it: [Test 4A — party price ₹110 versus ₹150](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:87), [4B — logo blocked for the second party](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:99).

The new form blocks changing customer if added rows draw from a booking. It does not provide equivalent handling for ordinary rows or the item currently being entered.

Two browser reproductions:

- Add a row for Party 1 at ₹110, then choose Party 2, whose price is ₹150. The added row remains ₹110; a fresh selection of the same item shows ₹150. There is no confirmation that Party 1's price is being retained.
- Select a LOGO item for Party 1, then switch to Party 2, which blocks logos for that category. The selected LOGO item can still be added for Party 2, at Party 1's price. Filtering it out of the dropdown did not invalidate the already-selected entry.

The old form also left already-added grid rows in place when switching customers, so the first issue is an inherited workflow weakness, not a protection proven to have existed before. It did clear the product-name selection on customer change, unlike the new form.

Repair: warn before changing a party with existing rows; offer a clear decision to discard/reprice ordinary rows while protecting saved/agreed rates. Clear or revalidate the entry row and recheck logo eligibility on Add and server save. Do not silently reprice historical orders.

Evidence: [old customer-change handler](D:/OneDrive/Desktop/Form8.vb.txt:540), [new customer-change handler](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:992), [dropdown-only logo filtering](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1031), [Add validation](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1647).

**5. High priority — ordinary items can be added before the selected party's prices finish loading**

Try it: [Test 5 — developer holds the new party's price response](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:109).

The special-rate hook retains the previous response while the new customer's request is pending. Ordinary Add does not wait for that customer's rate/restriction request. Refreshing rates updates the entry row, but cannot repair an item that has already moved into the added-items list.

Browser reproduction: hold Party 2's special-rate response pending, select Party 2 and add an item. The row was added at Party 1's ₹110, while one new-party request was still pending. Party 2's actual fixture rate was ₹150.

The old form performed its special-rate reads synchronously before completing the pick. This async transition therefore needs a new protection. Booking quotes already have an explicit pending/error gate; ordinary pricing lacks its equivalent.

Repair: associate rate results with the requested party/item and block Add while required initial data is unresolved or failed. A refresh policy should distinguish saved/agreed prices from newly entered prices. Show a short “Loading price…” or retry state rather than treating an unavailable response as no special rate.

Evidence: [retained previous response](D:/oms-online/apps/web/src/features/special-rates/use-special-rates.ts:34), [ordinary pricing fallback](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1400), [entry-only refresh effect](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1328), [booking quote gate](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1193).

**6. High priority — the server has no complete validation contract for ordinary order lines**

Try it: [Tests 6-00 through 6-16 — exact inputs, output names and expected results](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:122). These run in the isolated server audit, not against real orders.

`CreateOrderDto.items` is only checked as an array. Its contents are arbitrary records, and the service coerces fields rather than checking a complete line. Customer/date/status fields also have gaps. A valid-looking UI is insufficient protection for old drafts, another client, future UI regressions, or direct requests from an authenticated user.

The isolated probes passed through the same validation-pipe configuration as the API, then the real service:

| Submitted input | Observed result |
|---|---|
| Valid control: 70 kg × ₹100 | Saved correctly at ₹7,000 |
| Confirmed order with `items: []` | Saved an empty confirmed order |
| Confirmed order with `items: [{}]` | Saved a row with null identity/quantities/priority/unit and rate 0 |
| Unknown customer | Saved with `customerId: null` |
| Customer name containing only spaces | Saved as an empty customer name |
| Negative ordinary quantities | Saved; amount became −₹7,000 |
| Billing quantity zero | Saved at amount 0 |
| Billing quantity `"mistyped"` | Silently converted to null and saved at amount 0 |
| Missing/negative product rate | Saved |
| Product ₹100 + design ₹20, submitted total rate ₹1 | Saved rate ₹1; 70 kg produced ₹70 rather than ₹8,400 |
| Nonexistent product and design | Saved |
| Missing line priority, order type, billing unit | Saved null fields |
| Confirmed order without completion date | Saved with no due date/completion days |
| Completion date before order date | Saved the earlier due date but clamped completion days to 0 |
| Malformed order date | Not saved, but failed in Prisma instead of a clear business-validation error |
| Unknown order status | Saved `NOT_A_STATUS` |

Some of these are blocked by the normal fresh form; **they are server-level reproductions, not a claim that every input can be typed through the normal dropdowns**. Several could explain missing columns, but this audit does not prove the origin of any particular live record.

Repair: validate nested line records; reject unknown/missing required identities for new confirmed lines; validate finite nonnegative quantities and rates; require positive quantity in the configured billing unit; derive/check total rate from its components; validate dates and allowed lifecycle states. Use a deliberate, documented relaxation for drafts and legacy records rather than making every field optional everywhere. Preserve allowed manual prices instead of blindly overwriting them from today's master.

Evidence: [DTO](D:/oms-online/apps/api/src/orders/dto/order.dto.ts:6), [create path](D:/oms-online/apps/api/src/orders/orders.service.ts:272), [header conversion](D:/oms-online/apps/api/src/orders/orders.service.ts:1355), [line conversion](D:/oms-online/apps/api/src/orders/orders.service.ts:1382), [number coercion](D:/oms-online/apps/api/src/common/coerce.ts:14).

**7. High priority — a partial order update clears unrelated header fields**

Try it: [Test 7 — change only a comment and compare the header](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:152).

The update DTO explicitly permits partial input, but `update()` passes it through the full create-header conversion routine.

Isolated reproduction: update a confirmed order with only `{comment: 'Only this should change'}`. Its customer name became empty, due date became null, status became PENDING, and order date changed to the current instant. The existing New Order form normally sends the full header, so this is a shared API defect rather than the normal full-form save path.

Repair: update only supplied fields, or merge with the current complete record before validation. Do not use creation defaults to fill omitted PATCH fields.

Evidence: [partial DTO](D:/oms-online/apps/api/src/orders/dto/order.dto.ts:30), [update conversion](D:/oms-online/apps/api/src/orders/orders.service.ts:331), [creation defaults](D:/oms-online/apps/api/src/orders/orders.service.ts:1355).

**8. High priority — dispatched-order rules differ between save paths**

Try it: [Test 8A — compare two cancellation routes](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:162), [8B — shipped design/category](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:173), [8C — deletion and dispatch history](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:183). Use disposable data only.

These are related order-integrity findings discovered while tracing the save service, not missing fields on the New Order screen.

- **Cancellation bypass:** the dedicated status method correctly rejected cancelling a dispatched order with HTTP 400. Sending the same cancellation through the general order-update method succeeded; the order was CANCELLED while its dispatch remained.
- **Incomplete shipped identity check:** changing a shipped line's design name from NA to DIFFERENT DESIGN, and category from GLASS to CUP, succeeded. The guard compares `designType`, size and rates but omits the `design` name and category fields, even though its error text says the design cannot be edited.
- **Permanent deletion cascades into dispatches:** deleting a fixture order with a dispatch removed the dispatch too. This route is permission-protected and the UI requires typing DELETE. Therefore this is a **policy/design risk requiring an explicit decision**, not an unauthenticated deletion flaw. Its warning mentions the order and lines but does not clearly enumerate lost dispatch history. The old supplied form prevents deleting existing saved product rows.

Repair: apply cancellation/restoration rules at every write entry point; define all parts of shipped identity consistently; explicitly decide whether permanent deletion of dispatched/billed orders is ever allowed and enforce that policy in the server. Do not silently change the admin-delete policy during an unrelated UI fix.

Evidence: [dispatched identity guard](D:/oms-online/apps/api/src/orders/orders.service.ts:413), [general update](D:/oms-online/apps/api/src/orders/orders.service.ts:310), [dedicated cancellation guard](D:/oms-online/apps/api/src/orders/orders.service.ts:693), [permanent removal](D:/oms-online/apps/api/src/orders/orders.service.ts:679), [delete UI](D:/oms-online/apps/web/src/features/orders/orders-page.tsx:655), [old saved-row removal protection](D:/OneDrive/Desktop/Form8.vb.txt:1200).

**9. Medium priority — a filled but unadded item is omitted without a targeted warning**

Try it: [Test 9 — fill the second item, skip Add, inspect the save confirmation](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:193).

Browser reproduction: add the first row, fill out a second item with 24 pieces, then click Create order without clicking Add. The save dialog opens for the first row only. `validate()` blocks unfinished edits to an existing row, but not a new entry still waiting to be added. Local autosave also persists the added rows, not that entry.

The old save routine had the same general weakness: it saved grid rows, not the entry fields. This is useful hardening, not a missing old validation.

Repair: when a meaningful unadded entry exists, ask the user to Add it or explicitly discard it before saving. Store/restore that entry if the draft promise is intended to cover all typed work.

Evidence: [entry dirty flag](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1777), [save validation](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1936), [draft persistence](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:904), [old save](D:/OneDrive/Desktop/Form8.vb.txt:1430).

**Additional source-review observations**

These were established from code inspection, not included in the nine browser reproductions:

Proposed verification: [10A/10B — incompatible and invalid drafts](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:205), [11 — 02:00 AM Indian date](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:225), [12 — cancelled totals](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:235), [13 — different order types](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:245), [14 — identical catalogue labels](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:255).

- **Draft shape is not checked.** The loader casts parsed JSON directly to the expected type; restore calls `.some()`/`.map()` on `items`. Malformed or incompatible draft structures can throw. Restored rows are not rerun through Add validation when saved. [Draft loader](D:/oms-online/apps/web/src/features/orders/order-draft.ts:40), [restore](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:877).
- **Midnight date boundary uses UTC.** `today()` uses `toISOString().slice(0,10)`. Between midnight and 05:29 in India, that is the previous calendar date, affecting the default order date and future-date comparison. Use the business/local calendar date. [Date helper](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:317).
- **Cancelled-line totals disagree on edit.** The form's total sums all loaded rows; the server excludes CANCELLED rows. An order with cancelled lines can therefore show a different total in this form than its API/bill totals. [Form total](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1894), [server total](D:/oms-online/apps/api/src/orders/orders.service.ts:1756).
- **Duplicate definition differs.** Old code includes order type/category/subcategory/design/remark; new code mainly compares displayed item name/design name/remark. Different order types can trigger an unnecessary duplicate warning. More significantly, the new item dropdown deduplicates on display label alone, so two catalogue identities producing the same label collapse to the first. This needs a catalogue-collision check before changing the selector. [Duplicate check](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1704), [item map](D:/oms-online/apps/web/src/features/orders/order-form-page.tsx:1057).

**Old rules that are already covered, improved, or deliberately different**

Verify these too: [R01–R16 — a practical example for every comparison below](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:265).

| Old behaviour | Current behaviour | Assessment |
|---|---|---|
| Choose an existing customer/item/design name | Fixed-list controls and invalid-entry feedback | Present in the fresh UI; server enforcement incomplete |
| Completion days required before Save | Required for confirmed UI save, optional for drafts | Present; draft exception is intentional |
| At least one row before Save | UI checks `items.length` | Present in UI; missing in server |
| Design name required if the design has names | Explicit name required; NA when no choices exist | Preserved |
| Product/design special rate: most specific override first | Shared resolver uses item → subcategory → category | Preserved in principle; loading/customer transitions need repair |
| Product rate + design rate = total rate | UI calculates the sum | Preserved in UI; server trusts a contradictory supplied total |
| Numeric quantity entry | Number inputs and Add rejects negative quantities | Stronger UI check; numeric server contract incomplete |
| All four quantities nonblank after product selection | Requires positive billing quantity; other dimensions may be blank | Sensible improvement; do not require bags/box when irrelevant |
| Duplicate-entry confirmation | Checks all added rows and asks before adding again | Improved traversal, but matching definition differs |
| Saved product rows cannot be edited/deleted in this form | Saved order rows are locked; Order Modify handles edits | Preserved workflow |
| Cannot confuse Add with an active row edit | Update item path, edit/cancel state, save blocked mid-edit | Preserved/improved |
| Pieces calculate weight and boxes | Pieces calculation plus reverse Box → Pcs | Expanded; product-switch carryover needs repair |
| NO ITEM reserve row and conversion date | Separate booking with new dated linked orders | Intentional replacement, consistent with your earlier decision |
| Reserve overrun could be allowed after warning | Server checks booking ownership/status/total/category capacity | Stronger; existing isolated booking suite passes 25/25 |
| Order number chosen by max+1 | Database-generated ID and derived code | Improved concurrency safety |
| Old customer list includes all customers | New-order lookup includes active customers only | Policy difference; do not confuse with inactive parties needed for historical bank reconciliation |

**Old-code defects that should not be copied back**

Legacy examples: [L01–L06 — how to check each issue in a working old-OMS test copy](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:290). The supplied files alone are not a runnable old application.

- `CheckRowData()` returns False after the first nonmatching row, so it can miss a duplicate later in the grid. The new full-list search is better. [Old code](D:/OneDrive/Desktop/Form8.vb.txt:1153).
- `UpdateItem_Click()` writes fields to a row without rerunning the normal Add validation. [Old code](D:/OneDrive/Desktop/Form8.vb.txt:1280).
- Reserve quantity is deducted before the duplicate-entry confirmation inside `AddRowToGrid()`. If the user declines the duplicate, the in-memory reserve can already have been reduced without adding the product row. [Old call order](D:/OneDrive/Desktop/Form8.vb.txt:964).
- The old amount summary adds unit rates rather than rate × billing quantity. [Old total](D:/OneDrive/Desktop/Form8.vb.txt:1405).
- The old normal-item nonblank checks do not prove quantities are positive: product selection initializes all four to `0`, which passes a nonblank test. Exact numeric keystroke behaviour cannot be confirmed without `CheckNum`.
- Header/customer changes, date validity and unfinished new entry protection were not comprehensively checked by the old Save routine either.

**Recommended repair sequence**

1. Protect ordinary line money and quantities in both UI and server: rates, billing unit, nested fields, and final-save revalidation. Add targeted regression tests using the confirmed bad inputs above.
2. Fix product/customer transitions and loading states together: they are connected causes of stale values. Preserve saved/agreed booking rates and explicit overrides.
3. Repair PATCH semantics and unify lifecycle/dispatch guards. Resolve the permanent-delete policy separately.
4. Harden drafts, unadded-entry warnings, cancelled totals, and local date calculation.
5. After prevention is verified, perform a separate read-only scan for existing bad orders. Produce a proposed correction list; do not invent missing design/priority/rate/date values or rewrite billed history automatically.

Decisions to settle during repair: when explicit zero rates are allowed; whether ordinary rows should be repriced or discarded on customer change; whether pieces must be whole numbers; permitted weight precision; whether admins may permanently delete shipped orders. Fractional bags and intentionally entered actual weights must remain supported.

Discuss using concrete examples: [B01–B05 — zero rates, party changes, fractional pieces, weight precision and deletion](D:/oms-online/docs/audits/2026-09-19-new-order-user-test-guide.md:303).

**Reproduction tools**

- [Server audit](D:/oms-online/scripts/audit-order-form-validation.cjs): `node scripts/audit-order-form-validation.cjs`. Prints observations, using a temporary database that is removed afterwards.
- [Browser audit](D:/oms-online/scripts/audit-order-form-ui.cjs): set `PLAYWRIGHT_MODULE` to an installed Playwright module if needed, then run `node scripts/audit-order-form-ui.cjs`. Uses installed Chrome and a local fixture API; non-fixture traffic is blocked. Set `AUDIT_CASE=design-rate` to run the additional design-rate-clearing scenario.
- Existing booking check: `node scripts/test-booking-order-capacity.cjs` — 25/25 passed on this audit.

The two audit scripts report observed behaviour. **Exit code 0 means the audit completed, not that validation is correct.** They should be converted into expected-rejection/expected-correction regression tests as each fix is implemented.
