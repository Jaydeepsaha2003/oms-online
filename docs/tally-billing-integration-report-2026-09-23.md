# OMS ↔ TallyPrime Billing Integration: Discovery & Architecture Report

**Date:** 23-Sep-2026. This began as a discovery snapshot; see the owner-review update below for the implemented billing-rate flow. No OMS voucher has been written to Tally during this work.

**Evidence used:**
- OMS source code in this repo (NestJS API, React web app, `@oms/shared`).
- The live OMS database (`apps/api/prisma/dev.db`), queried read-only.
- The live TallyPrime at `192.168.0.245:9000`, queried read-only through XML *Export* requests. No import was ever sent.

---

## Update: owner review (23-Sep-2026)

- **Mismatches:**
  - SSS-454/455 (SUMTI/CHAITANYA) and SSS-698 (Sanjay Bartan) are solved by the owner.
  - SSS-426 (DIN BANDHU) was nullified with Credit Note #9 (11-Aug). It was re-billed as SSS-529 on the new LLP ledger, deliberately keeping the original dispatch date in OMS so the 60-day credit runs from dispatch.
  - SSS-491 (KALAKRITI) was nullified with Credit Note #6 (06-Aug).
  - **SSS-468 (S.M.R AGENCIES ₹67,759) is still open.** OMS cancelled it and re-billed the same dispatches as SSS-577 (₹67,520), but Tally has **no credit note** for 468. Tally therefore carries both invoices.
- **Billing-rate / NB update (23-Sep-2026):** the owner clarified C is a Gaushala amount, not cash, and asked that it stay outside the Tally sales invoice. For billing-rate challans, the owner wants OMS to post B using the Billing Rate for GST-bearing KGS (including eligible SCRAP KGS); the current code implements that path. No-bill challans remain blocked. This supersedes the discovery-only implementation decision below; statutory treatment still needs CA confirmation before using the posting flow.
- **E-invoice login every ~6 hours:** do not store portal credentials in code. This remains the separate project (§49).
- **Firewall on :9000:** declined by the owner. The risk in §AE is accepted.
- **Instant sync:** the owner wants millisecond Tally → OMS updates. Plan changed: add a small TDL "on voucher save → HTTP POST to OMS" (Phase 6), **plus** the AlterID poll as a safety net. OMS → Tally stays direct (no bridge), which is already the fastest path.
- **Posting rules confirmed by the owner, and checked against the FY 26-27 Tally invoices:**
  - An OMS line with unit KGS goes to `S.S.UTENSILS/GLASS`.
  - An OMS line with unit PCS (glass, cup or loti) goes to `S.S.UTENSILS/GLASS (PCS)`.
  - SCRAP goes to `S.S.SCRAP`.
  - Packing + freight go to `PACKING CHARGES`. Box (pouch) goes to `BOX CHARGES`. Both are taxed.
  - Tax: `IGST 5%` for inter-state, generic `CGST` + `SGST` for intra-state. Scrap TCS goes to `TCS @2%` (the amount is 1%). Then `ROUND OFF`.
  - Lines with the same item and rate are merged (current practice).
  - B K METAL is billed for all of agent B KUMAR's parties.
  - PNB → `PNB KITCHENMATE LTD BAHALGARH`. DIN BANDHU → `DIN BNDHU METAL MART LLP`.
  - Scrap invoices also come from OMS, in the same `SSS-` series. There are no Tally-only sales in FY 26-27.
- **Trial:** the owner alone posts. The Tally version is 7.1.
- **Testing:** the owner can't make a test company, so testing happens on the live company. Real full-bill challans are posted one at a time, and IRN/EWB are generated **only after** the voucher is checked. A wrong voucher without an IRN can simply be deleted.
- **Existing bug fixed** (§B-1):
  - `update()` now runs the "dispatch already billed" check inside one transaction.
  - `updateStatus()` refuses to reinstate a cancelled invoice whose lines were re-billed. Verified on a DB copy: re-confirming 468 is refused because its lines are on 577.

---

## 0. The findings that change the design

These six facts, all verified against live data, reshape the whole concept. Read them first.

| # | What I found | Why it matters |
|---|---|---|
| F1 | **The OMS "Challan" is already the tax invoice.** `challans.code` = `SSS/26-27/739`. The pricing engine (GST, freight, packing, TCS/TDS, round-off) already runs in OMS. The "Pending Challan" screen lists *dispatch lines not yet on an invoice*. | The "billing batch" you described already exists: it is the Challan row. We don't need a new batch system. We need to **post an existing Challan to Tally** instead of retyping it. |
| F2 | **Today every invoice is typed twice.** Someone re-enters each OMS challan into Tally by hand as `SSS-739/26-27`. The serial numbers are kept aligned manually. In FY 26-27, 733 of 742 OMS invoices pair with a Tally voucher by serial number. | The integration replaces a manual process that is **already drifting** (see F3). The go-live must link these 733 existing invoices, or the system will try to post them a second time. |
| F3 | **Manual re-entry has already caused real mismatches:** two invoices with their parties swapped, one wrong amount, three invoices cancelled in OMS but still live with an IRN in Tally, and dates up to 25 days apart. | This proves the value of the integration, and it proves that reconciliation is needed from day one. Details are in §D. |
| F4 | **Tally receives the "B" amount, not the OMS total.** For 729 of 733 matched invoices, the Tally amount equals OMS `b`. In billing-rate mode (`billingRate > 0`), Tally uses that rate for billed KGS. Example: SSS-735 is billed in Tally at **₹180/kg**, while the OMS lines are priced at **₹395–405/kg**. In FY 26-27, 358 of 738 confirmed invoices (48%) are billing-rate invoices: OMS value ₹1.72 Cr, Tally value ₹1.00 Cr, and ₹71.75 lakh ("C") outside Tally. "NB/" challans never reach Tally. | The owner has now instructed OMS to generate billing-rate invoices using B and the GST-bearing KGS lines, with C identified as a Gaushala amount and excluded from the Tally sales invoice. This is implemented; the statutory/accounting treatment remains a CA-confirmation risk (§AF-1). |
| F5 | **E-invoicing and e-way bill are already live inside Tally.** All 739 FY 26-27 sales vouchers carry an IRN. E-way bills are generated in Tally (for example, EWB 232292835817 on SSS-739). The Tally registration is set to: e-invoice from 01-Aug-2023, e-way bill threshold ₹50,000 on invoice value. | The statutory workflow already works. OMS should **read** IRN, Ack and EWB back from Tally, not re-implement them. |
| F6 | **Tally's XML port is open to the whole LAN with no authentication.** A plain company export returned the company's **RSA private key** (`DOCUMENTKEY`). | Anyone on your Wi-Fi or VPN can read all your books and create vouchers. Fix: one Windows Firewall rule on the Tally PC (§AE). |

---

## A. My understanding of your business requirement

You dispatch goods through OMS. The dispatched lines become billable. Staff should turn selected lines into a correct GST invoice in Tally without retyping it. The invoice must be traceable back to the exact dispatches. Duplicates must be practically impossible. Any later change made in Tally must be detectable. Staff should get speed; accounting should keep control.

## B. The existing software flow (as the code actually works)

```
Order ─► OrderItem ─► Dispatch (bags / pcs / kgs, rate snapshot)
                           │   "Pending Challan" = dispatches with no live challan line
                           ▼
        Create Challan (select lines → draft → computeChallanTotals → save)
            • one SQLite transaction: number, duplicate check, "dispatch already billed" check, insert
            • Challan = tax-invoice header (code SSS/26-27/N, b, c, tax, total, gst %, freight, packing…)
            • ChallanItem.dispatchId links every line back to its dispatch  ← traceability exists
                           ▼
        (manual) accountant retypes into Tally → generates e-invoice + e-way bill in Tally → prints
```

The pieces we can reuse:

| Need | Already in OMS |
|---|---|
| Duplicate / concurrency guard | `ChallansService.create`: number, `assertNotDuplicate` and `assertDispatchesUnbilled` in one transaction. Also a party dispatch lock (`activeLockOwners`). |
| Traceability, invoice → dispatch | `ChallanItem.dispatchId` → `Dispatch.orderItemId` → `Order` |
| One calculator | `computeChallanTotals` in `@oms/shared` (used by the form; the server stores what the client sends) |
| RBAC | `resource:action` permissions, enforced server-side (`PermissionsGuard`) |
| Audit | `AuditInterceptor` logs every mutating request to `audit_logs` |
| Approvals | `ApprovalRequest` (open `type`) |
| Config store | `app_config` key/value (`CHALLAN_PREFIXES`, `TCS_PERCENT`, …) |
| Tally XML parsing | Regex tag readers in `account-groups/tally-master.parser.ts` (no XML library installed) |
| Tally masters snapshot | `tally_ledgers` (453 rows, name + group) and `tally_party_alias` (8 rows). These were loaded from your XML upload. |
| Receipt recon | `tally-recon` module (register upload). It covers **receipts**, not sales invoices. |

**Gaps in the current code that matter for the integration:**
1. `ChallansService.update()` does **not** re-run `assertDispatchesUnbilled`, and it is not a single transaction. An edit can add a dispatch line that is already billed on another challan, which is a double-billing path that exists today.
2. After a challan is saved, it can still be renumbered, re-dated, re-partied, edited, cancelled, or **hard-deleted** (`remove()`). Once an invoice exists in Tally, all of these must be locked.
3. The server stores `total`, `tax`, `b` and `c` exactly as the browser computed them. It does not recompute them.
4. GST is one rate per challan: `gst = max(line rates)`. 39 challans mix product categories.
5. `Customer` has no GSTIN field, and `state` is free text ("Maharashtra", "MAHARASHTRA", "MAHARASTRA", "HYDERABAD"). OMS cannot decide CGST/SGST vs IGST reliably, so Tally's ledger must own that decision.
6. Roles: 5 users are `operator`, 1 is `super_admin`, and the `manager` role has **0 users**.

## C. The current Tally setup (live, read-only discovery)

| Item | Found |
|---|---|
| Server | TallyPrime at `192.168.0.245:9000` ("TallyPrime Server is Running"). **Silver** (single-user) licence. |
| Version | The version functions returned nothing over XML. **Please check F1 → About.** The XML schema used here is stable across TallyPrime 2.x–6.x. |
| Company | **S.S.STEEL**, GUID `8b635e82-c329-4a1f-8e44-58e7b5f076dd`, number 10001. **One company for all years**, books from 01-Apr-2021. This is good: GUIDs never split by year. |
| Features | Accounts and inventory integrated, bill-wise ON, GST ON, TCS/TDS ON. Security ON (user `SSSTEEL`). Edit Log **OFF**. Tally Audit OFF. |
| GST registration | `27AEZPJ0295B1ZA`, Maharashtra, Regular. PAN type "P", which suggests a proprietorship: confirm, because it decides whether the edit-log/audit-trail rule applies. E-invoice **applicable** (from 01-Aug-2023), with e-way bill included. EWB threshold ₹50,000 inter-state **and** intra-state, on invoice value. Last GST sync on 22-Sep-2026. |
| Sales voucher type | One type, "Sales", parent Sales. Numbering **Automatic (Auto Retain)**, prefix `SSS-`, suffix `/26-27`, width 2, restarts yearly. **Prevent Duplicates = No.** |
| Other voucher types | Credit Note (automatic, no prefix) and Debit Note (prefix `DN`). Delivery Note uses manual numbering. |
| Invoice shape (verified on SSS-735/736/739) | **Item Invoice.** One inventory line per OMS line, all on the stock item `S.S.UTENSILS/GLASS` (KGS) at the actual rate per kg. Sales ledger `SALES`. Freight, packing and pouch are **combined into `PACKING CHARGES`** and taxed. Tax ledger `IGST 5%`, or `CGST 2.5%`/`SGST 2.5%` within Maharashtra. `ROUND OFF`. Consignee = buyer. `BASICSHIPPEDBY` = transporter. EWB Part-A carries the transporter GSTIN and distance. |
| Stock items (10) | S.S.UTENSILS/GLASS (KGS, HSN 732393), S.S.UTENSILS/GLASS (PCS), S.S.UTENSILS (PCS), S.S.SCRAP (KGS), PLASTIC BAG, CORRUGRATED BOX, S.S.CIRCLE, S.S.PATTA, LABOUR JOB, FABRICATIONS. Tally **tracks stock** on them. |
| Units | KGS (3 dp), PCS (2 dp) |
| Tax ledgers | CGST, SGST, CGST 2.5%, SGST 2.5%, IGST 5%, IGST @12%, IGST 18%, **IGST @18% (rate 0)**, Tcs, TCS @0.75%, TCS @2%. There are duplicate or inconsistent ledgers here, and posting must pin exact ledgers. |
| Debtors | 237 ledgers under Sundry Debtors. 223 have a GSTIN, 234 are Regular, 2 Composition, 1 Unknown. **147 are outside Maharashtra.** Two GSTINs are shared by two ledgers each: CRYSTAL IMPEX / NX CRYSTAL IMPEX, and STARLINES HOME PRODUCT(S). |
| Identifiers | Every object has a GUID = company GUID + hex(MasterID). For example, voucher MasterID 23901 → `…-00005d5d`. Vouchers also carry AlterID and VoucherKey. `REMOTEID` = GUID. |
| TDL | Nothing custom is visible on vouchers (only the standard `PFTDLVERSIONINFO`). Confirm under F1 → TDLs & Add-ons. |

## D. What you told me vs what actually exists

| You said / assumed | Reality | Consequence |
|---|---|---|
| Manager selects **pending challans** and creates a bill | Pending Challan = un-invoiced dispatch lines. Creating the "Challan" **is** creating the invoice (in OMS). | "Create Bill in Tally" = **post an OMS invoice to Tally**. The approval or permission gate sits on *posting*. |
| Tally has simplified lines (one summary row) | Tally already gets **one line per OMS line** (same stock item, actual rate) in full-bill mode. | No lossy summarising is needed. Detail and traceability stay in OMS as they do today. |
| React ledger mapping exists | There is no mapping *field*. OMS relies on name equality with the uploaded `tally_ledgers` (86 of 115 active customers match) plus 8 aliases. 23 active customers match nothing. | We need a real mapping keyed by the Tally GUID (§K). |
| Mapping is 1:1 | In real billing, **many OMS customers → one Tally ledger**: "B K METAL" is billed for RAJ STEEL (B KUMAR), ROOPI (B KUMAR), CHANDINI (B KUMAR) and BK METAL. Also **one customer → two ledgers over time**: PNB (old / Bahalgarh) and DIN BANDHU (proprietorship / LLP). | Mapping is many-to-one and can change on a date, for example after a GSTIN or constitution change. |
| E-invoice / EWB needs building | It already runs in Tally for 100% of invoices. | Mirror its status; don't rebuild it. |
| A local bridge service is needed | OMS server `192.168.0.236` reaches Tally `192.168.0.245` directly over the LAN. | No bridge is needed (§E). |
| React and Tally are in sync | Not quite. See the live mismatches below. | Reconciliation is part of phase 1, not an afterthought. |

**Live mismatches found (FY 26-27):**

| Invoice | OMS | Tally | Kya galti hai |
|---|---|---|---|
| 454 | SUMTI MARKETING ₹22,350 | CHAITNYA STAINLESS STEEL ₹26,328 | Dono bills ki party ulti ho gayi hai. IRN Tally wale number pe bana hai. |
| 455 | CHAITANYA STAINLESS STEEL ₹26,328 | SUMTI MARKETING NX ₹22,350 | Wahi swap, ulta. |
| 698 | SANJAY BARTAN BHANDAR B ₹35,399 (total ₹50,299) | ₹50,623 | Amount alag hai. Tally ka amount OMS ke total se bhi zyada hai. |
| 426 | DIN BANDHU METAL MART ₹30,981, **CANCELLED** | Live, with IRN | OMS me cancel hai, Tally me bill zinda hai. Party ka outstanding dono jagah alag dikhega. |
| 468 | SMR AGENCIES ₹67,759, **CANCELLED** | Live, with IRN | Same as 426. |
| 491 | KALAKRITI THE ART STUDIO ₹1,05,645, **CANCELLED** | Live, with IRN | Same as 426. |
| 529 | DIN BANDHU, date 17-Jul | Date 11-Aug | Date me 25 din ka fark hai. |
| 272 / 5 / 52 / 391 | — | Date off by 1–4 days | Chhota date fark. |

👉 **Check in Tally:**
- Day Book for 25-Jul-2026, SSS-454 and SSS-455: kis party ka IRN hai?
- SSS-698: sahi amount kaunsa hai?
- SSS-426, 468 and 491: kya ye sach me cancel hone the? Agar haan, to IRN 24 ghante ke baad cancel nahi hota, credit note banana padega.

---

## E. Proposed final architecture

**MY IDEA:** React → backend → local bridge → XML → Tally, plus TDL events for real-time two-way sync.

**PROBLEM:**
- A separate bridge is a second process to install, monitor, restart and secure. It adds nothing when the backend can already reach Tally on the LAN.
- TDL events need deployment on the Tally PC, break on Tally upgrades, and **still** need polling as a fallback, because an event sent while OMS is down is lost.

**BETTER APPROACH:** A small `tally` module *inside the existing NestJS API*. It talks to Tally's HTTP/XML port directly, using Node's built-in `fetch`, and reuses the existing regex tag readers. Tally → OMS sync is **polling by AlterID**. There is **no TDL** in phases 1–3.

**WHY:** It has the fewest moving parts, one deployment, and one log. It also works when OMS was down, because polling always catches up. If OMS ever moves to the cloud, *then* add a thin agent on the Tally PC. (`ponytail:` no bridge. Add one only if OMS stops being on the same LAN as Tally.)

## F. Architecture diagram

```
┌──────────── Browser (React) ────────────┐
│ Pending Challan → Create Challan (as today)                                  │
│ Challan list: [Post to Tally] button + Tally status chip                     │
│ Tally Sync Center (admin): queue · UNKNOWN · exceptions · mapping · logs     │
└──────────────────────┬──────────────────┘
                       │ HTTPS/JSON (JWT, RBAC: challan:post, tally:manage)
┌──────────────────────▼──────────────── OMS API (NestJS, 192.168.0.236) ───────────────────────┐
│ ChallansService (existing)  ── invoice data, locks edits once posted                          │
│ TallyModule (new, small)                                                                        │
│   • tally.client   : POST xml → Tally, timeout, parse CREATED/ERRORS/LASTVCHID                 │
│   • tally.voucher  : Challan → Sales-voucher XML (pure function, unit-tested)                  │
│   • tally.post     : claim → validate → send → verify → link   (state machine, §O)             │
│   • tally.poll     : every 3 min AlterID delta + nightly full sweep → recon status (§V)         │
│ SQLite: challans … + tally_voucher (link/status) + tally_post_log (every attempt, XML in/out)  │
└──────────────────────┬──────────────────┘
                       │ HTTP XML on LAN :9000 (firewalled to 192.168.0.236 only)
┌──────────────────────▼──── TallyPrime Silver (192.168.0.245), company S.S.STEEL ──────────────┐
│ Sales voucher (legal invoice) · GST computation check · e-Invoice/IRN · e-Way Bill · print     │
│ No custom TDL. Inline TDL inside XML *requests* is used for reading (nothing installed).        │
└──────────────────────────────────────────────────────────────────────────┘
```

## G. Responsibilities

| Layer | Owns | Never does |
|---|---|---|
| React | Selection UI, showing validation results and status, the "Post" button (permission-gated) | Money maths, deciding eligibility, talking to Tally |
| API / ChallansService | Invoice content, the dispatch → invoice link, numbering, **one** totals calculation (`computeChallanTotals`, re-run server-side at post time) | Guessing a Tally ledger |
| API / TallyModule | Pre-post validation gate, XML building, sending, response parsing, verification, the state machine, polling and recon | Changing invoice content |
| Database | Unique link (one OMS doc ↔ one Tally voucher) as a **DB constraint**, attempt log, status | — |
| Tally | Legal voucher, ledger impact, GST ledgers and item tax config, IRN, EWB, legal print | Receiving edits from OMS automatically |
| TDL | Nothing in phase 1–3. Optional later: a Tally-side lock or display field (§AC). | Business rules |
| Bridge | Not built | — |

## H. What standard XML handles (no TDL)

- Creating the Sales voucher, with a `SVCURRENTCOMPANY` pin and a result report (`CREATED`, `ERRORS`, `LASTVCHID`, `LINEERROR`).
- Reading the company (GUID, name), ledgers by GUID, stock items and GST details, and voucher types.
- Reading a voucher by number, GUID or MasterID after posting (verification).
- Change detection: vouchers with `AlterID > watermark`.
- Deletion detection: a linked GUID is no longer returned.
- Cancellation detection: `ISCANCELLED`.
- IRN, Ack No/Date and EWB number read-back (`IRN`, `IRNACKNO`, `IRNACKDATE`, `EWAYBILLDETAILS.LIST/BILLNUMBER`).

All my discovery queries in this report used inline TDL inside the XML request. Nothing was installed in Tally.

## I. What genuinely needs TDL

**Nothing for the required scope.** Candidates evaluated and rejected for now:

| Candidate | Verdict |
|---|---|
| Real-time events on voucher alteration | Polling by AlterID every 2–5 minutes is enough ("React should eventually know"), and it survives OMS downtime. |
| Custom UDF for an OMS reference | The deterministic voucher number plus the stored GUID are enough. Add a UDF only if you want the OMS id *visible* inside Tally. |
| Triggering IRN/EWB generation from OMS | Not possible through standard XML. It would mean either automating Tally's own online e-invoice action with TDL (fragile and undocumented) or calling a GSP/IRP API from OMS (paid, a second statutory source, and a credentials burden). **Keep generating in Tally; OMS mirrors the status.** |
| Blocking alteration of OMS-posted vouchers in Tally | Try Tally's native security first (user roles restricting Alter on Sales). Use TDL only if native roles can't do it without also blocking e-invoice generation (to be tested). |
| Repeated GST/e-invoice login (your §49) | Separate project, as you asked. Not mixed in here. |

## J. Assessment of the existing ledger mapping

- It is **name-based**, a snapshot from 21-Sep, with no GUID stored. `tally_ledgers` holds only name and group.
- **Stale by design:** a ledger rename in Tally breaks it silently. A new similar-named ledger can capture it.
- In real FY 26-27 billing, 193 of 733 invoices use a Tally party name that differs from the OMS name (18 distinct pairs). Only 9 of those pairs are covered by aliases.
- `tally_party_alias` maps Tally name → customer (the right direction for *recon*, reading Tally). Billing needs customer → **the one ledger to bill now**.
- Two ledger pairs share a GSTIN, so GSTIN alone cannot identify a ledger either.

**Verdict:** keep it for receipt reconciliation, but don't use it for billing.

## K. Recommended mapping strategy

1. Add `tallyLedgerGuid` to `Customer`, plus a cached `tallyLedgerName` for display. **Many customers may point to the same GUID** (the B K METAL case), and that is allowed deliberately.
2. An admin maps each customer on a mapping screen. OMS *suggests* a ledger (exact name → alias → GSTIN), and the admin must confirm. **Never auto-map silently.**
3. **Re-validate live before every post.** This is one small XML read by GUID, so there is no need for a cache. The checks:
   - The ledger exists and is not deleted.
   - It is under Sundry Debtors.
   - The GSTIN format is valid, and its state code matches the ledger state.
   - The registration type is known.
   - The current name is what gets used in the XML.
4. If the ledger was renamed → update the cached name (INFO).
5. If the GSTIN or state changed since the admin confirmed the mapping → **BLOCK** until the admin re-confirms. A GSTIN change usually means a new legal entity, as in the DIN BANDHU → LLP case.
6. Changing the mapping is logged: old GUID, new GUID, who, when. It never affects already-posted invoices, which keep their own party GUID in `tally_voucher`.

## L. Stable-identifier strategy

| Identifier | Stable across | Changes when | Use for |
|---|---|---|---|
| Company GUID | Rename, backup/restore | New company, split, migration to a new company | Guard: refuse to post if the open company's GUID ≠ the configured GUID |
| Ledger GUID / MasterID | Rename, GSTIN edit, backup/restore | Ledger deleted and re-created; new company | **Ledger mapping** |
| Voucher GUID / MasterID | Alteration, renumbering, backup/restore | Voucher deleted and re-entered; new company | **Voucher link** (primary key of the link) |
| Voucher AlterID | — | *Every* alteration (global counter) | **Change detection.** A watermark going *down* = an older backup was restored. |
| Voucher number | Until someone renumbers it | Manual edit, or auto-renumber in some modes | Idempotency lookup (with Prevent Duplicates ON) and the human reference. Not the primary key. |
| Name (ledger or voucher party) | — | Any edit | Display only |

- **Backup/restore of the same data** keeps every GUID.
- **Restoring an *older* backup** makes vouchers posted after it disappear, and the AlterIDs go back. Detection: linked GUIDs go missing and the max AlterID drops. The response is an alarm plus MISSING_IN_TALLY exceptions, **never** an auto-repost.
- **Split company or migration into a new company** gives new GUIDs. Treat it as a new company: re-link by voucher number + date (an admin tool).
- I have not verified "Rewrite data" on this install. Test it on a copy before relying on it.

## M. Source-of-truth matrix

| Field | Owner | After posting |
|---|---|---|
| Order, dispatch, pcs/kg/bags, design, product, dispatch status | OMS | — |
| Invoice lines (commercial detail) and traceability to dispatches | OMS | Frozen once posted |
| Invoice number (legal) | **OMS assigns** (existing series). Tally stores it and enforces uniqueness. | Tally's value is authoritative. Any difference = exception. |
| Invoice date | OMS proposes | Tally authoritative. Difference = exception. |
| Rates / prices | OMS (customer rates) | Frozen |
| Operational party (customer) | OMS | — |
| Accounting party, GSTIN, state, registration type, billing address | **Tally ledger** | Voucher keeps its own snapshot |
| OMS customer → Tally ledger mapping | OMS (admin) | Not retroactive |
| GST **rate** | **Tally stock item / ledger** (statutory). OMS `gst_rates` must *agree*, otherwise block. | — |
| Tax, round-off and total amounts | Calculated once by `computeChallanTotals` (server), sent explicitly, **verified** against what Tally accepted | Tally authoritative. Difference = exception. |
| Stock-item and ledger choice (Sales, Packing, tax, round-off, TCS) | OMS config (`app_config` `TALLY_CONFIG`), validated live against Tally | — |
| Voucher GUID / MasterID / AlterID | Tally → stored in `tally_voucher` | Updated by the poller |
| IRN, Ack No/Date, EWB no/date | Tally / NIC → OMS read-only mirror | — |
| Cancellation | **Tally first.** OMS mirrors it after verifying. | — |
| Link, post status, recon status, attempt log | OMS `tally_voucher` / `tally_post_log` | — |
| Stock quantities for S.S.UTENSILS/GLASS etc. | Tally (already tracked there) | — |

## N. Billing workflow (business intent → technical stages)

"Create Bill in Tally" breaks down into these stages:

1. **Select** lines on Pending Challan (existing).
2. **Save the challan** (existing, with transaction guards) → `tally_voucher.status = NOT_POSTED` (or `NOT_ELIGIBLE`, see §AF-1).
3. The user with `challan:post` clicks **Post** (single or multi-select).
4. For each challan, **independently and sequentially**:
   1. Read-only pre-checks: Tally reachable, company GUID, voucher date inside the FY and after the GST lock date, the party ledger re-validated by GUID, stock items / tax ledgers / units exist, the stock-item GST rate matches, and the voucher number is not already in Tally.
   2. Server recomputes totals from the stored lines → must equal the stored `total`/`tax`, otherwise BLOCK.
   3. **Atomic claim:** `UPDATE tally_voucher SET status='POSTING' WHERE docId=? AND status IN ('NOT_POSTED','FAILED')`. If 0 rows changed → "already being posted / posted".
   4. Build the XML (a pure function) and **write the request to `tally_post_log` before sending**.
   5. Send with a 30-second timeout.
   6. Parse the Tally result. HTTP 200 alone means nothing.
   7. **Verify:** read the voucher back by `LASTVCHID`/number, then compare number, date, party GUID and total.
   8. Store the GUID, MasterID and AlterID → `POSTED`, and lock the challan in OMS.
   9. On a timeout or any doubt → `UNKNOWN`, and resolve it by lookup (§R).
5. The accountant generates e-invoice and EWB in Tally, as today. Tally supports bulk "Send for e-Invoicing".
6. The poller mirrors IRN and EWB into OMS and flags any later change.
7. Print from Tally (the legal copy with IRN/QR).

**One voucher per XML request.** A multi-voucher envelope returns aggregate counts (for example "5 created, 1 error") without saying which one failed. One request per voucher gives an unambiguous result.

## O. Billing state machine (simplified from your 20 states)

**MY IDEA:** One linear chain: DRAFT → VALIDATING → … → PRINTED → COMPLETED (about 20 states).

**PROBLEM:**
- Validation is a synchronous gate, not a stored state.
- Statutory status, print status and recon status are *independent dimensions*. Putting them in one chain creates impossible combinations, such as PRINTED but MODIFIED_IN_TALLY, and more transition code.

**BETTER APPROACH:** One small **post status** plus three read-only mirror fields.

```
post status:   NOT_ELIGIBLE      NOT_POSTED ──claim──► POSTING ──ok+verified──► POSTED
                                     ▲                  │   │
                                     │ fix & retry      │   └─timeout/crash/ambiguous─► UNKNOWN
                                     └──── FAILED ◄─────┘ (Tally rejected AND lookup     │
                                             ▲              confirms nothing was created) │
                                             └──── lookup: absent ◄───────────────────────┤
                                                   lookup: present & matches ─► POSTED ◄──┘
                                                   lookup: present & differs ─► POSTED + recon=MISMATCH
mirrors (from Tally, never set by users):
   irn:   PENDING | GENERATED | CANCELLED
   ewb:   NOT_REQUIRED | PENDING | GENERATED | CANCELLED
   recon: OK | MODIFIED_IN_TALLY | AMOUNT_MISMATCH | CANCELLED_IN_TALLY | MISSING_IN_TALLY | DUPLICATE_IN_TALLY
```

| Rule | Detail |
|---|---|
| Allowed | The transitions shown above. |
| Forbidden | UNKNOWN → POSTING (it must be resolved by lookup first). POSTED → anything except via recon. Editing, deleting, renumbering, re-dating or re-partying a challan in POSTING, UNKNOWN or POSTED. |
| Retry | Only from FAILED, or automatically from UNKNOWN once the lookup proves the voucher is absent. The retry sends the **same voucher number**, so Tally's duplicate guard is a second safety net. |
| Crash recovery | On API start, and every minute, POSTING older than 2 minutes → UNKNOWN. |
| Admin override (`tally:manage`, audited) | "Link to existing Tally voucher" (used for the 733 historical invoices and for manual fixes). "Mark FAILED after manual check" (only when Tally is reachable and the lookup is empty). |
| Logged | Every attempt: user, time, request XML, response XML, parsed result and resulting state. Every override is logged with a reason. |

## P. Validation matrix

Every check runs in **one place**: `TallyPostService.validate()`, server-side, at post time. React only displays the result.

| Validation | Source | Level | Message (short) | Admin override? | Audit |
|---|---|---|---|---|---|
| Tally reachable | Tally | BLOCK | "Tally is not reachable at 192.168.0.245. Is Tally open?" | No | Log |
| Open company GUID = configured | Tally | BLOCK | "Wrong company open in Tally" | No | Yes |
| Challan is SALES INVOICE, CONFIRMED | OMS | BLOCK | — | No | — |
| Challan is a full bill (`noBill = false`, `billingRate = 0`, no manual B/C/tax override) | OMS | BLOCK (§AF-1) | "Only full-value invoices can be posted" | No | Yes |
| Not already linked, and status ∈ NOT_POSTED/FAILED | OMS DB | BLOCK | "Already posted as SSS-…" | No | Yes |
| All lines' dispatches not on another live invoice | OMS | BLOCK | existing message | No | Yes |
| Recomputed totals = stored totals (±₹0.01) | OMS shared calc | BLOCK | "Totals changed since save, re-open and save" | No | Yes |
| Single GST rate across lines | OMS | BLOCK | "Mixed GST rates not supported yet" | No | — |
| Customer mapped to a Tally ledger | OMS | BLOCK | "Tally ledger mapping missing for X" | No (fix the mapping) | Yes |
| Mapped ledger exists live, under Sundry Debtors | Tally | BLOCK | "Mapped ledger not found in Tally" | No | Yes |
| GSTIN or state changed since mapping was confirmed | Tally vs OMS | BLOCK | "GSTIN changed, re-confirm mapping" | Re-confirm = fix | Yes |
| GSTIN format and state-code consistency; registration type known | Tally | BLOCK | — | No | Yes |
| Party unregistered or composition | Tally | WARN | "B2C / composition invoice, no IRN" | — | Yes |
| Tax type: intra (CGST+SGST) vs inter (IGST), from company state vs ledger state (place of supply) | Tally | derived | — | — | — |
| Ship-to state ≠ bill-to state | OMS shipping address | BLOCK (phase 1) | "Different delivery state not supported yet" | No | — |
| Stock item exists for category + unit; unit KGS/PCS exists | Config + Tally | BLOCK | "No Tally item for category CUP" | No | — |
| Stock-item GST rate = OMS GST % | Tally | BLOCK | "GST rate differs: OMS 5%, Tally 18%" | No | Yes |
| Tax / Sales / Packing / Round-off / TCS ledgers exist | Config + Tally | BLOCK | — | No | — |
| Voucher date in Tally company period; not before the GST lock date (last filed GSTR-1 period) | Tally + config | BLOCK | "Period already filed" | **Yes** (admin, with reason) | Yes |
| Voucher date ≠ today | OMS | WARN | "Back-dated invoice" | — | Yes |
| Voucher number not already in Tally | Tally | BLOCK (→ offer "link") | "SSS-… already exists in Tally" | Link = admin | Yes |
| Previous UNKNOWN for this challan resolved | OMS | BLOCK | "Resolve the earlier attempt first" | — | — |
| Invoice ≥ EWB threshold and transporter missing | OMS | WARN | "E-way bill will need transporter" | — | — |
| Party on dispatch hold / inactive | OMS | WARN | — | — | Yes |

## Q. Duplicate-prevention strategy (defence in depth)

1. **UI:** the button is disabled while a request is in flight (convenience only).
2. **DB-level claim:** a conditional `UPDATE … WHERE status IN (...)`. SQLite serialises writers, so exactly one request wins. Double-clicks, two tabs and two users all hit the same row.
3. **DB constraints:** `UNIQUE(docType, docId)` and `UNIQUE(tallyGuid)` on `tally_voucher`. One OMS invoice can never link to two vouchers, and one voucher can never link to two invoices.
4. **Deterministic identity in Tally:** OMS sends the voucher number (`SSS-{n}/{fy}`). **Turn Tally's Sales numbering to "Automatic (Manual Override)" with Prevent Duplicates = Yes.** A blind resend is then *rejected by Tally itself*.
5. **REMOTEID:** also set `REMOTEID="OMS-CH-{challanId}"` on the voucher. My understanding is that Tally treats a re-import with the same REMOTEID as the *same object*. **This is to be proven on a test company before we rely on it.** If it holds, it is a third guard; if it doesn't, guards 1–4 stand without it.
6. **Lookup before any retry** (§R).
7. **Existing guards stay:** OMS's content duplicate check (`assertNotDuplicate`) and dispatch-already-billed check. The `update()` gap in §B-1 is fixed as a prerequisite.
8. **Cut-over:** all 733 historical invoices are linked as POSTED before the button is enabled.

## R. Unknown-state recovery

Triggers: a timeout, a network error, an API crash during POSTING, or unparseable output.

1. Set UNKNOWN and tell the user "Not sure if Tally saved it. Checking…". **No retry button.**
2. The resolver runs immediately, then every minute:
   1. Confirm Tally is reachable and the company GUID is correct. If not, stay UNKNOWN.
   2. Look up the voucher by number (and by REMOTEID if proven) in its date window. Tally processes requests one at a time, so a lookup made after the original request has finished sees its result.
   3. **Found and matches** → POSTED. **Found but different** → POSTED + recon exception. **Absent, confirmed twice 60 seconds apart** → FAILED (retryable).
3. Only admins can override, and every override is audited.

## S. Retry strategy

| Situation | Auto-retry? |
|---|---|
| Tally unreachable, wrong company, or validation failed | No. Nothing was sent. The challan stays NOT_POSTED with a message. |
| Tally rejected the voucher (ERRORS > 0, CREATED = 0) and the lookup is empty | No auto-retry. FAILED, with Tally's error shown in plain language. A human fixes the cause, then retries. |
| UNKNOWN | The resolver decides (§R). It never blindly resends. |
| Poller or recon read failure | Yes: the next cycle. It is idempotent and read-only. |

## T. Two-way sync strategy

- **OMS → Tally:** create only, and only on an explicit Post. There is **no automatic alter** in phase 1. Corrections follow the legal route: cancel in Tally (IRN cancellation is allowed only within 24 hours), then cancel in OMS and re-issue, or use a credit/debit note.
- **Tally → OMS:** read-only mirror. A poller runs every 3 minutes: `Sales vouchers WHERE AlterID > watermark`, fields limited to GUID, number, date, party, amount, cancelled, IRN and EWB. It updates the mirror fields and recon status. There is also a **nightly full sweep** of the FY sales list (739 vouchers ≈ one small request) to catch deletions, restores, and Tally-only sales.

## U. Circular-sync prevention

This is by construction, so no origin markers are needed:
- Tally → OMS writes touch **only** `tally_voucher` mirror and recon fields, never invoice content.
- OMS → Tally writes happen **only** on a human Post of a NOT_POSTED/FAILED challan, never in reaction to a sync.
- No path turns a Tally change into an OMS business change, or the other way round. A difference becomes an **exception for a human**.

## V. Reconciliation design

| Case | Detected by | Result |
|---|---|---|
| Matched | Number, date, party GUID, total and cancel flag all equal | OK |
| Voucher altered after posting | AlterID > stored value → field compare | MODIFIED_IN_TALLY (ignored if only IRN or EWB fields changed) |
| Amount differs | Compare | AMOUNT_MISMATCH |
| Cancelled in Tally | `ISCANCELLED` | CANCELLED_IN_TALLY. The admin then cancels in OMS, and the dispatches return to the pool. |
| Linked GUID gone | Nightly sweep | MISSING_IN_TALLY (a deletion or an older restore). An alarm if many go missing at once. |
| Tally sales voucher with no OMS link | Nightly sweep | "Tally-only sale" list (info). For example, a manual scrap or labour invoice. |
| Two Tally vouchers look like one challan | Same party + date + amount | DUPLICATE_IN_TALLY |
| OMS cancelled, Tally live | Sweep | Exception (today: #426, #468, #491) |

- **Exception queue:** the Sync Center filters `recon ≠ OK`.
- Each exception carries a review mark with a note, reusing the existing `TallyReconMark` idea.
- **On-demand:** a "Reconcile now" button.
- **Cut-over:** the first sweep links the historical invoices and produces today's mismatch list.

## W. Audit logging

- **`tally_post_log`** (new): one row per attempt, with these fields:
  - challan id and code, attempt number, user, start and end time
  - the state before and after
  - Tally counters (created, errors, …), `LASTVCHID`, and the error text
  - the request and response XML, stored as text (about 10 KB each)
  - no passwords, because Tally XML carries none. **Do not** store company exports; the DOCUMENTKEY lesson applies.
- **`tally_voucher`** (new), one row per OMS invoice:
  - doc type and id, company GUID, voucher GUID, MasterID, AlterID, voucher number and date
  - party ledger GUID, total, status
  - IRN, Ack No, Ack date, EWB no and date
  - recon status, last checked, posted at and by
- **Existing `audit_logs`** already captures the API call, mapping edits and overrides. Add `@Audit` descriptions.
- Your suggested log fields are all covered by these two tables plus the existing challan and customer rows. There is no duplicate storage.

## X. User permissions (reusing RBAC)

| Permission | Who | Allows |
|---|---|---|
| `challan:view` / `challan:create` | Manager, operators (existing) | Pending Challan, create challan |
| **`challan:post`** (new) | Admin (and the manager, if you choose Mode B) | Post to Tally, see validation results |
| **`tally:view`** (new) | Admin, manager | Sync Center (business-readable errors) |
| **`tally:manage`** (new) | Admin only | Mapping, config, UNKNOWN overrides, link historical vouchers, view XML, run recon |

**Mode A vs Mode B** is simply *who holds `challan:post`*. Unposted challans wait in the Sync Center's "To post" queue for someone who has it. No `ApprovalRequest` replay machinery is needed. (`ponytail:` add a formal approval request only if you need a recorded approve/reject decision per invoice.)

## Y. Failure and recovery design

| Scenario | Final state | Auto recovery | User message / manual step |
|---|---|---|---|
| Tally PC off / Tally closed / port closed | NOT_POSTED (nothing sent) | — | "Tally not reachable. Open Tally on the accounts PC and retry." |
| Wrong company open / company closed | NOT_POSTED | — | "S.S.STEEL is not open in Tally" |
| Tally stuck on a dialog (common on Silver) | UNKNOWN (timeout) | Resolver once Tally responds | "Tally is busy. Close any open dialog on the Tally PC." |
| LAN drop or timeout after send | UNKNOWN | Lookup → POSTED or FAILED | "Checking whether Tally saved it…" |
| Voucher created, response lost | UNKNOWN → POSTED | Lookup finds it | — |
| API crash mid-post | POSTING → UNKNOWN (sweeper) | Lookup | — |
| DB write fails after Tally success | UNKNOWN (claim row stays POSTING) | Lookup links it | — |
| UI timed out but the post succeeded | POSTED | — | Status refreshes via websocket or reload |
| Double click / two users / two tabs | One POSTING, others 409 | — | "Already being posted by X" |
| Tally rejects (ledger or item missing, date, number) | FAILED | — | Plain-language Tally error, then fix and retry |
| Malformed XML | FAILED (Tally error) | — | Admin sees XML; covered by unit tests |
| 1 of 6 invoices fails | That one FAILED/UNKNOWN; the other 5 POSTED | — | Per-invoice result list |
| E-invoice or EWB fails in Tally | POSTED, irn=PENDING | Poller keeps checking | Accountant retries in Tally |
| Printer fails | Unaffected | — | Reprint from Tally |
| Manual edit in Tally | POSTED + MODIFIED_IN_TALLY | — | Admin reviews |
| Cancelled in Tally | POSTED + CANCELLED_IN_TALLY | — | Admin cancels in OMS (verified) |
| Voucher deleted / older backup restored | MISSING_IN_TALLY (+ AlterID-regression alarm) | Never auto-repost | Admin decides: re-post (same number) or cancel |
| Ledger renamed | — | Name refreshed from GUID | Info |
| Ledger GSTIN changed | Next post BLOCKS | — | Admin re-confirms mapping |
| Voucher renumbered in Tally | POSTED + MODIFIED_IN_TALLY | — | Admin reviews |
| FY change | Number suffix from invoice date. Company spans all years. | — | GST lock date guards filed periods |
| Statutory portal down | No effect on posting | — | Generate IRN later in Tally |

## Z. Printing

- The **legal print comes from Tally** (e-invoice with IRN and QR, plus the EWB). It stays a separate step, as you wanted. A print failure touches nothing else.
- Once posted, the OMS PDF shows the Tally number and IRN. Until then it is clearly marked "not a tax invoice".
- **Automatic printing from OMS:** there is no standard XML command that prints. It is not recommended. Tally's multi-voucher print covers bulk printing.

## AA. Statutory configuration strategy

- The applicability rules (e-invoice from 01-Aug-2023, EWB at ₹50,000 on invoice value) are **already configured in Tally's GST registration**, and Tally applies them. OMS must **not** keep a second copy of those thresholds.
- OMS keeps only:
  - (a) the **GST lock date** (last filed GSTR-1 period), stored in `app_config`
  - (b) the data completeness that EWB will need later: transporter GSTIN/ID and distance per party
- **Please confirm with your CA:** whether Maharashtra's current intra-state EWB threshold matches the ₹50,000 that Tally is set to. Rules change, and Tally's setting should be the one kept correct.

## AB. Database changes (minimal)

| Change | Why |
|---|---|
| `customers.tallyLedgerGuid`, `customers.tallyLedgerName` (nullable) | Mapping (§K) |
| New `tally_voucher` (unique `docType+docId`, unique `tallyGuid`) | Link, status and mirrors. Generic, so credit and debit notes fit later. |
| New `tally_post_log` | Attempt audit |
| `app_config` key `TALLY_CONFIG` (JSON): url, company name and GUID, sales/packing/round-off/TCS/tax ledger names, category+unit → stock item map, GST lock date, enabled flag | Config without new tables |

There are no changes to existing columns, and no new services, queues or databases.

## AC. TDL modules

**None required.** Optional later, only if native Tally security can't do it: a small TDL that blocks *alteration/deletion* of vouchers with an `OMS-` REMOTEID for non-admin Tally users, and an "OMS ref" display field.

## AD. XML request/response strategy

- **Import** (one voucher per request):
  - Envelope `TALLYREQUEST=Import`, `TYPE=Data`, `ID=Vouchers`
  - `SVCURRENTCOMPANY=S.S.STEEL`
  - `<VOUCHER VCHTYPE="Sales" ACTION="Create" REMOTEID="OMS-CH-{id}">`
  - `PERSISTEDVIEW = Invoice Voucher View`, `ISINVOICE = Yes`
  - Inventory lines (item, rate/unit, qty, amount) with an accounting allocation to SALES
  - Ledger lines: party (debit total), PACKING CHARGES, tax ledgers, ROUND OFF, TCS for scrap
  - `BASICSHIPPEDBY` = transporter, `BASICFINALDESTINATION`
  - Amounts **sent explicitly**, as calculated by `computeChallanTotals`
- **Response:** parse `CREATED`, `ALTERED`, `IGNORED`, `ERRORS`, `EXCEPTIONS`, `LASTVCHID` and `LINEERROR`. Success requires CREATED=1, ERRORS=0, EXCEPTIONS=0, **plus** read-back verification.
- **Reads:** inline-TDL collections with explicit `FETCH` lists, never `*` (see F6). Dates always use typed `SVFROMDATE`/`SVTODATE`; untyped dates were silently ignored in discovery.
- **Encoding:** UTF-8 request. Decode responses as UTF-8 or UTF-16 (the existing `decode()` handles both). Escape `&` in names (for example "MANGAL & MANGAL").
- **Parsing:** reuse the regex tag helpers. There is no XML library, and Tally's reply structure is flat and fixed.

## AE. Security risks

| Risk | Fix |
|---|---|
| **Tally :9000 is unauthenticated and LAN-wide.** It exposed the company's RSA private key, and it allows writing vouchers. | **Windows Firewall on 192.168.0.245:** allow TCP 9000 only from 192.168.0.236. This is native, and needs zero code. Also check that the VPN/tunnel can't reach 9000. |
| XML logs hold business data | `tally:manage` only. They are covered by the existing backup. |
| Any OMS user could post | New `challan:post` permission, enforced server-side |
| Config tampering (a ledger map pointing to the wrong ledger) | `tally:manage` only; audited |
| Credential handling for GST portals | Not in this project. Tally keeps them. (§49 stays separate.) |

## AF. Business and accounting risks

1. **AF-1 (CRITICAL): Billing-rate and no-bill.**
   - The owner clarified on 23-Sep-2026 that C is a Gaushala amount, not cash, and requested that it stay outside the Tally sales invoice. For a billing-rate challan, OMS posts the saved B amount, prices GST-bearing KGS lines at Billing Rate, and calculates GST on those billed lines. The complete challan total remains separate from the Tally sales voucher amount.
   - The code now follows that instruction, saves each line's GST rate with the challan, and blocks posting if a KGS line's saved GST rate is missing or conflicts with the challan rate. Posting remains a deliberate, permission-gated action.
   - **The statutory/accounting treatment still needs CA confirmation.** A lower GST invoice than the full challan total may be under-valued if C is consideration for goods. This code change is not legal or tax approval; confirm how the Gaushala amount should be documented and reported before using this path.
   - No-bill challans remain blocked. Previously hand-entered invoices should be linked/reconciled, not posted again.
2. **AF-2: Posting before the invoice is final.** About 460 FY challans show edits after creation (some may be data migrations). The posting button must be a deliberate step, and editing must lock after posting.
3. **AF-3: Historical double-posting at go-live** if the 733 existing invoices aren't linked first.
4. **AF-4: GST rate held per customer in OMS, per item in Tally.** Divergence → wrong tax. Block on mismatch.
5. **AF-5: Invoice-number ownership.** If anyone keeps raising Sales invoices directly in Tally in the same `SSS-` series, OMS numbers will collide. That needs a separate series or voucher type.
6. **AF-6: Periods already filed** (GSTR-1): back-dated posting must be blocked by the GST lock date.
7. **AF-7: Receipts are double-entered too** (OMS and Tally). This is out of scope, but it is the next source of drift.

## AG. Risk register

| Requirement | Your assumption | Problem | Severity | Recommended solution | Needs your decision? |
|---|---|---|---|---|---|
| Post bills to Tally | Post the OMS "B" amount | Under-valued GST invoices / IRNs (AF-1) | **CRITICAL** | Full-value invoices only; CA confirmation | **YES** |
| Go-live | Start posting new challans | 733 already in Tally → duplicates | **CRITICAL** | Link historical invoices first (Phase 3) | No |
| Duplicate prevention | Transaction IDs | Tally has Prevent Duplicates OFF; a retry after a lost response could duplicate | **CRITICAL** | Claim + DB unique + manual-override numbering with Prevent Duplicates ON + lookup-before-retry | Yes (Tally setting change) |
| Edits after posting | — | OMS allows edit, renumber, delete after save | **CRITICAL** | Server-side lock once POSTING/UNKNOWN/POSTED | No |
| Challan edit | — | `update()` can double-bill dispatch lines | HIGH | Add the guard inside a transaction (prerequisite fix) | No |
| Tally security | LAN is safe | Open port leaks the private key; anyone can write | HIGH | Firewall rule | Yes (IT action) |
| Party mapping | Mapping exists | Name-based, stale, many-to-one, GSTIN entity changes | HIGH | GUID mapping + live revalidation | Yes (confirm the B K METAL-type cases) |
| Invoice number | Tally generates it | Two numberers today, aligned by hand | HIGH | OMS assigns, Tally enforces | **YES** (manual Tally sales series) |
| Existing mismatches | Systems agree | 7 mismatches today (§D) | HIGH | Fix in Tally/OMS before cut-over | **YES** (you check) |
| Real-time sync | TDL events | Fragile, lossy when OMS is down | MEDIUM | AlterID polling | No |
| Local bridge | Needed | Extra process, no benefit on the LAN | MEDIUM | Inside the API | No |
| E-invoice / EWB automation | OMS drives it | No XML trigger; second statutory source | MEDIUM | Keep in Tally; mirror status | Yes (confirm) |
| GST rate | OMS per customer | Conflicts with item HSN rate | MEDIUM | Tally item rate authoritative; block on mismatch | No |
| Mixed-rate challans | — | Single `gst` % per challan | MEDIUM | Block mixed rates in phase 1 | No |
| Ship-to ≠ bill-to | — | Place of supply | MEDIUM | Block in phase 1 | Yes (how often does this happen?) |
| Tally Silver busy / dialogs | — | Timeouts | MEDIUM | UNKNOWN resolver + clear message | No |
| Older backup restored | — | Silent loss | MEDIUM | AlterID regression alarm + MISSING list | No |
| Printing automation | Auto-print | Not possible via XML | LOW | Print from Tally | No |
| Second company or factory | Future | GUIDs are per company | LOW | `companyGuid` stored on every link | No |

## AH. Missing requirements you didn't mention

- Cut-over linking of historical invoices, plus the clean-up of today's mismatches.
- An immutable invoice in OMS after posting; corrections via Tally cancellation or credit/debit notes.
- An OMS cancel must follow a *verified* Tally cancel. IRN cancellation is possible only within 24 hours; after that, use a credit note.
- A GST lock date for filed periods.
- A separate number series for any Sales invoice raised directly in Tally.
- Credit notes (OMS `CN/…`) and debit notes (`DN/…`) are also retyped today. The same pattern applies later (`docType`).
- Unregistered and composition buyers (14 debtors have no GSTIN; 2 are composition): no IRN, and a different tax treatment.
- TCS on scrap uses its own ledger. TDS is deducted by customers, so it does not belong on the invoice.
- Tally stock: posting reduces Tally's stock of S.S.UTENSILS/GLASS, so Tally production entries must keep up.
- Operational: Tally must be open with S.S.STEEL loaded during billing hours. Unposted challans simply wait.
- The receipts double-entry (AF-7).
- Backup discipline for both OMS SQLite and Tally, and a restore drill.

## AI. Conflicting requirements, and a rule for each

| Conflict | Rule |
|---|---|
| OMS operational truth vs Tally accounting truth | OMS owns what was dispatched and priced. Tally owns the legal invoice after posting. Differences become exceptions, never auto-overwrites. |
| Automatic billing vs financial approval | Posting is a permissioned human action (`challan:post`). Auto-post is off. |
| Real-time sync vs circular updates | One-way writes each direction, on different fields only (§U) |
| Detailed OMS items vs summarised Tally items | Not really a conflict: Tally already gets one line per OMS line on a common stock item. Detail lives in OMS. |
| Manual Tally edits vs OMS integrity | Allowed but detected (MODIFIED_IN_TALLY). Optional Tally-role lock. |
| Auto-retry vs duplicates | Never retry from UNKNOWN without a lookup. Deterministic number plus Prevent Duplicates. |
| Manager speed vs control | Validation is automatic and instant. Only BLOCK items stop the manager, with a plain message. |
| Local simplicity vs reliability | Reliability comes from state and verification, not infrastructure. No bridge, queue or TDL. |

## AJ. My improvements to your concept (summary)

- No new billing-batch system: the Challan *is* the batch.
- No bridge, no TDL.
- A 5-state post machine plus 3 mirrors, instead of 20 states.
- Tally keeps e-invoice and EWB; OMS mirrors them.
- GUID-based many-to-one mapping, revalidated live on every post.
- Deterministic voucher number with Tally's Prevent Duplicates as a second lock.
- Reconciliation and the historical link come **before** posting, so the first delivery carries zero write risk.

## AK. Minimum-code implementation plan

| Phase | What | Writes to Tally? | Rough size |
|---|---|---|---|
| 0 | You: firewall rule, fix the 7 mismatches, answer §AM. Me: fix the `update()` double-billing guard. | No | ~15 lines |
| 1 | `tally.client` (fetch + timeout + parse) and a health/company check shown in a Sync Center stub | No | ~120 lines |
| 2 | GUID mapping: two Customer columns, a mapping screen with suggestions, live verify | No | ~250 lines |
| 3 | `tally_voucher` table + link historical invoices + nightly recon sweep + exception list | No | ~300 lines |
| 4 | **Test company** (a copy of S.S.STEEL restored under another name). Prove: import format, Prevent Duplicates, REMOTEID behaviour, timeout-then-lookup, cancel detection. | Test company only | Scripts |
| 5 | Post-to-Tally for full-value challans: validator, XML builder, state machine, post lock on challans. Enabled by a flag, first on the test company, then live. | Yes | ~400 lines |
| 6 | AlterID poller, IRN/EWB mirror, UNKNOWN resolver, Sync Center filters | No | ~200 lines |
| 7 | Credit notes / debit notes (same pattern) | Yes | ~150 lines |
| 8 (optional) | EWB data prefill (transporter GSTIN, distance); OMS print shows IRN | Yes | — |

Every phase is a small, reviewable diff. Each one gets the objective, files, DB change, risk, rollback and test procedure before I start, as you asked.

## AL. Testing plan

- **Unit tests** use Node's built-in test runner, so there is no new dependency. Covered:
  - the XML builder (full bill; KGS, PCS and mixed; intra vs inter state; packing; round-off; scrap TCS)
  - the response parser (created, error, exception, line error, garbage)
  - the state transitions (every allowed and forbidden edge)
  - the validator (each BLOCK rule)
- **Test-company runs** (scripted; Phase 4). Each of these must pass before production:
  - normal invoice; several challans from one party; missing mapping; GSTIN changed; wrong company open; Tally closed
  - duplicate click (two parallel posts → one voucher)
  - **timeout after create** (the reply is dropped on purpose → UNKNOWN → lookup → POSTED, with no duplicate)
  - one of six failing
  - manual alteration → MODIFIED; manual cancel → CANCELLED; voucher deleted → MISSING
  - restore of an older backup → AlterID alarm
  - API restart during POSTING
- **Go-live check:** the historical link must show **0 unexplained** mismatches before the Post button is enabled.

## AM. Questions that need your business decision

These are in simple Hinglish, as you prefer for accounts matters.

1. **Half-bill / No-bill (sabse zaroori):** Aaj lagbhag aadhe bills Tally me ₹180/kg jaise billing rate pe bante hain. Asli rate ₹400/kg ke aas-paas hai, aur baaki "C" amount books ke bahar rehta hai. Main automation sirf **poori value** ke bills ke liye banaunga. Kya aap apne CA se baat karke confirm karenge ki aage kaise bill karna hai? Jab tak decision nahi hota, half-bill aur NB bills pehle ki tarah manual hi rahenge.
2. **Invoice number:** Go-live ke baad kya koi Tally me seedha Sales bill banayega (labour job, box, scrap)? Agar haan, to uske liye alag series (jaise `SST-`) chahiye. Aur kya Tally ki Sales numbering ko "Automatic (Manual Override)" + "Prevent Duplicates = Yes" karne ki permission hai?
3. **Kaun post karega:** Kis user ko "Post to Tally" ka right milega (Mode A ya Mode B)? System me "manager" role abhi kisi user ko assigned nahi hai. Manager kaun hai?
4. **Kab post karna hai:** Challan save hote hi, ya din ke end me review karke?
5. **Galti sudhaarna:** Kya aap ye rule accept karte hain: post hone ke baad bill OMS me edit nahi hoga; pehle Tally me cancel ya credit note, phir OMS me?
6. **Freight + packing + pouch:** Aaj teeno ek hi "PACKING CHARGES" ledger me jaate hain. Waise hi rakhna hai, ya alag ledgers chahiye?
7. **Stock item mapping:** GLASS (KGS) → S.S.UTENSILS/GLASS aur GLASS (PCS) → S.S.UTENSILS/GLASS (PCS) sahi hai? **CUP, LOTI, TUMBLER** kis Tally item me jaayenge? SCRAP → S.S.SCRAP?
8. **B K METAL jaise case:** RAJ STEEL (B KUMAR), ROOPI (B KUMAR), CHANDINI (B KUMAR) aur BK METAL, sab ka bill "B K METAL" ledger pe banna sahi hai? Aur PNB / DIN BANDHU ke liye ab kaunsa ledger chalu hai?
9. **Mismatches (§D):** SSS-454/455, 698, 426/468/491 aur 529 Tally me check karke batayiye ki sahi kya hai.
10. **Security:** Tally PC pe firewall rule lagane ki permission (sirf OMS server hi Tally se baat kare)?
11. **E-invoice / EWB:** Accountant Tally me hi generate karta rahe aur OMS sirf status dikhaye, theek hai?
12. **Delivery address:** Kitne bills me maal kisi aur state me deliver hota hai (bill-to ≠ ship-to)?
13. **Tally version:** F1 → About me TallyPrime ka version bata dijiye.

---

## RECOMMENDATIONS I WOULD ADD TO YOUR ORIGINAL CONCEPT

### CRITICAL (before production)
- Billing-rate invoices now use B, the Billing Rate and saved per-line GST eligibility; no-bill challans remain blocked. Confirm the Gaushala accounting treatment with your CA before using the posting flow.
- Link all historical invoices to their Tally vouchers before enabling Post, and fix today's 7 mismatches.
- Lock a challan in OMS once posting starts (no edit, delete, renumber, re-date or re-party).
- Duplicate defence: DB claim + unique link + deterministic voucher number with Tally Prevent Duplicates ON + lookup-before-retry.
- An UNKNOWN state with an automatic resolver, and no manual retry button while it is unresolved.
- Firewall Tally port 9000 to the OMS server only.
- Fix the existing `update()` double-billing gap.
- GUID-based party mapping, revalidated live on every post.

### IMPORTANT
- GST lock date for filed periods.
- The Tally stock-item GST rate must equal the OMS rate.
- A separate series for Tally-only sales.
- A nightly recon sweep, plus an AlterID-regression (restore) alarm.
- Cancellation always goes Tally-first, verified by OMS.
- `challan:post`, `tally:view` and `tally:manage` permissions.

### OPTIONAL
- A Tally-role (or small TDL) lock on altering OMS-posted vouchers.
- OMS print shows the Tally number and IRN.
- EWB data prefill (transporter GSTIN, distance).
- Auto-post on save for trusted users.

### FUTURE
- Credit and debit note posting (same pattern).
- Receipts integration to end the second double-entry.
- A second company or factory (config + `companyGuid`, already designed in).
- A thin agent on the Tally PC if OMS ever leaves the LAN.
- The separate GST-login project (§49).
