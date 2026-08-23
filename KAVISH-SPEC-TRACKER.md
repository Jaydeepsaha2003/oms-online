# Kavish Steel — Change Spec Tracker

Tracks every item in `Kavish_Steel_Full_Software_Change_Spec.md` from requirement →
development → your testing. Statuses follow §19.4 of the spec.

**Status key:** ⬜ Open · 🔵 In Progress · ✅ Developer Completed · 🟢 Verified by owner ·
🟡 Partly done · ❓ Needs owner answer · 🔁 Reopened

**Last updated:** 23 Aug 2026

---

## Summary

| Status | Count | Tickets |
|---|---|---|
| ✅ Developer Completed | 35 | K-14.1 … K-14.14, K-16, K-17.1, K-17.2, K-10.1, K-2.1, K-13.1, K-4.1, K-7.1, K-11.1, K-3.1, K-12.2, K-5.2, K-6.1, K-6.2, K-9.1, K-4.2, K-5.1, PD-1, PD-2, PD-3, PD-4 |
| 🔵 In Progress | 0 | — |
| ⬜ Open | 0 | — |
| 🟡 Partly done | 2 | K-8, K-15 |
| ❓ Needs owner answer | 4 | K-2.2, K-9.2, K-12.1, K-18 |

---

## Answered questions (§20) — no code change needed

| Ticket | Question | Answer |
|---|---|---|
| **K-4.2** | Transporter form Packing/Freight — purpose? | ✅ A **default** copied onto a Customer at import time (`customers.service.ts`: `packing ?? transporter?.packing`). Never read during pricing. 39 of 52 transporters carry a value. Safe to keep. |
| **K-5.1** | Transporter vs Transporter Rates — source of truth? | ✅ **`trans_rates` is the source of truth.** Challan pricing reads it (`type IN ('FREIGHT','PACKING')`, preferring the matching transporter). 640 rows. The Transporter fields only seed new customers, so a difference between them cannot mis-price a challan. |
| **K-6.2** | "Select all (318 matching)" — meaning? | ✅ Every product matching the **current search + filters across all pages**, fetched on demand. The header checkbox beside it selects only the **current page**. Selection survives page turns so a set can be built up before acting. |
| **K-9.1** | Designs — purpose of the Actions checkbox? | ✅ It is **"show on rate list"**, same control as Products. Deliberately separate from Active: Active = usable on orders; show-on-rate-list = appears on the printed sheet. A design can be active but off the sheet. |

---

## Open questions — blocked on you

| Ticket | Item | What I need |
|---|---|---|
| **K-2.2** | Role-based landing page | Routing is already implemented (`HomeRoute` redirects users without `dashboard:view`). Your `admin`/`manager`/`viewer` roles **do** hold `dashboard:view`, and analytics is gated on that same permission — so I cannot reproduce a blank Dashboard. **Which user or role sees it?** |
| **K-9.2** | Design form full redesign | Awaiting your UltraWeb/call session. |
| **K-12.1** | CRM follow-up reminders not appearing | Need a concrete example — which reminder, expected where/when, what you see instead. Investigating blind risks "fixing" correct behaviour. Worth knowing: the `followups` table currently holds **1 row** (a DELIVERY, already DONE), so there may simply be nothing due to remind about. |
| **K-18** | "Rate of Design on Cup per KG", Ghungroo, Amri | GUNGROO = a design type under CUP (₹3, two sub-categories). **AMRI does not exist anywhere** — nearest are AMRAPALI (APS) / AMRAPALI DELUX SPECIAL (Glass), DAMRU CUP / DAMRU DOUBLE WALL (Cup). Which did you mean? And confirm CUP design rates are per-kg additions. |

---

## §2 Login, Access & Notifications

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-2.1 | Consolidate the two notification bells | ✅ Completed | One bell now. Device enrolment moved **inside** the popover as a dismissible band; users without `crm:view` still get a bell purely to enrol, and it disappears once enrolled. Split into two components so CRM queries never fire for a user who cannot read CRM. |
| K-2.2 | Role-based landing page | ❓ | See open questions. |

## §3 Global Form Header

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-3.1 | Remove duplicated form title under the global header | ✅ Completed | **12 pages** cleaned: Users, Approvals, Activity Log, Bag Bookings, Price History, Party Lists, Settings, Special Rates, Manage Cheques, Roles & Permissions, Agents, Quotations. Only the repeated icon + `<h2>` were removed — every subtitle (live record counts) and every action button kept, so nothing but the wasted row is gone. Sub-pages that show record-specific titles (New Booking, Convert Booking, Follow-ups/Payment Desk) were deliberately left alone: the topbar does not show those. Also removed 9 now-dead icon imports. |

## §4–§5 Transporter & Transporter Rates

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-4.1 | Make the active-customer count clickable → list those customers | ✅ Completed | Count opens a popup listing party, agent, city/state, mobile. **Also fixed a real defect:** the count included INACTIVE customers (6 of them), so every transporter was overstated — it is now active-only, matching the column's meaning. Verified count and list agree exactly (AKBAR TRANSPORT: 8 = 8). List fetched only when opened. |
| K-4.2 | Packing/Freight purpose | ✅ Answered | |
| K-5.1 | Source of truth | ✅ Answered | |
| K-5.2 | "Recent Changes" beside Bulk Rate Change | ✅ Completed | **No migration needed** — `rate_history` already stored exactly these fields and `GET /transport-rates/history` already returned them unfiltered. Added the button beside Bulk rate change and a dialog listing Party, Category, Type, Transporter, old → new, **change amount**, date/time and user, newest first. The existing per-row History icon answers a different question (one rate's trail) and is untouched. |

## §6–§7 Products & Product Photos

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-6.1 | Product "View Recent Changes" | ✅ Completed | `product_rate_history` only ever covered the RATE, so a new `product_changes` table (**migration `20260822190000_product_changes`**) logs every other field — name, category, sub-category, size, pcs, weight, active, show-on-rate-list — one row per field with old → new, who and when. Rate changes stay in their own trail (booking repricing depends on it) and are **not** duplicated. "Recent changes" button on the Products toolbar. Verified against a DB copy. |
| K-6.2 | "Select all (318 matching)" | ✅ Answered | |
| K-7.1 | Product Photos From/To date field formatting | ✅ Completed | The inputs had `flex-1 min-w-0`, letting them shrink **below** a native date field's intrinsic width — the dd-mm-yyyy segments clipped and collided with the picker icon. Given a width that fits their own content; the row now wraps on narrow screens instead of crushing the fields. Added aria-labels. |

## §8 Search & Combo-box UI

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-8 | Standardise search/combo-box treatment | 🟡 Partly | Navy thick borders already applied app-wide to Search/Find/Filter inputs, and placeholder colour lightened. Still to do: "All Parties"/"All Products" default text made clearly visible, and the navy border extended to combo-boxes that are not search inputs. |

## §9 Designs

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-9.1 | Actions checkbox purpose | ✅ Answered | |
| K-9.2 | Full form redesign | ❓ | Awaiting call. |

## §10–§11 Order Form & Challan

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-10.1 | Customer prompt timing | ✅ Completed | Prompt no longer shows on open; appears only when the user reaches for the item area, then stays until a customer is picked. |
| K-11.1 | Party filter in the challan item-wise search | ✅ Completed | After picking an item, a **Party** dropdown narrows its history to one customer. Client-side (the rows are already loaded), offered only when the item has more than one party, and reset when the item changes. The lines/qty/amount strip recomputes from the filtered rows so it can never contradict the table. |

## §12 CRM

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-12.1 | Follow-up reminders not appearing | ❓ | Need a reproducible example. |
| K-12.2 | New Inquiry panel | ✅ Completed | Built as **option (a)**: `INQUIRY` is a third follow-up kind, so an enquiry reuses the whole existing machinery — reminders, timeline, checklist, party links — instead of a parallel model. New **CRM → New Inquiries** page and menu entry at `/crm/inquiries`. An unrecognised kind still falls back to DELIVERY, so older clients are unaffected. Verified: all three kinds create and filter independently. |

### Payment follow-up desk — direct request, 23 Aug 2026

| Ticket | Item | Status | Notes |
|---|---|---|---|
| PD-1 | Show exact **B – Bank / C – Cash** split per invoice | ✅ Completed | The open-invoice list now carries the billed split, not just the balance: **B / Bank** in blue, **C / Cash** in green, a dash where that side is empty, and the full rupee figure on hover. Data check: the split is populated on all 1,967 challans, and 1,123 of them are genuinely billed across both sides — so this column was hiding real information. |
| PD-2 | Select multiple invoices | ✅ Completed | Tick-box on every invoice row. A footer appears only once something is ticked (so single-invoice use is unchanged) showing how many are selected, the B and C totals, the combined balance, and **Use selected**, which fills the follow-up with all the picked invoice numbers and their total. |
| PD-3 | Saving a follow-up fired a reminder immediately | ✅ Completed | Real defect. `nextRemindAt` was left empty on create, and the scheduler treats "no next reminder time" as *already due* — so the moment you saved, it nudged you about the thing you had just typed. Now the first reminder is set an hour ahead and clamped into working hours. Verified: on create `nextRemindAt` lands ~60 min out and the follow-up does **not** appear in the due list straight away. |
| PD-4 | Quiet-hours (DND) for reminders, per user | ✅ Completed | **Settings → General → Reminder quiet hours**: a switch plus From / Until times, with a "Quiet right now" badge. Deliberately per-user, not per-installation — the owner and a floor operator keep different hours. Windows crossing midnight (21:00 → 08:00) are handled. A reminder landing inside your window is **delayed, not cancelled**: it stays in CRM and on the bell and pushes once the window ends. If *everyone* is quiet nothing is marked as sent, so nothing is lost. Verified: default off, saving mutes only that user (3 recipients → 2 awake), invalid times rejected, and a corrupt preference falls back to "not quiet" rather than silencing someone forever. |

## §13 Administration — Users

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-13.1 | Distinguish account-Active from actually-in-use | ✅ Completed | Status column renamed **Account**; new **Last active** column shows a green "Using now" (activity within 15 min), otherwise relative time ("3 days ago") or "Never used", plus open-session count. Activity is read from the audit log (what they actually did), sessions from live refresh tokens. Two batched queries — no N+1. |

## §14 Rate List — all completed earlier

| Ticket | Item | Status |
|---|---|---|
| K-14.1 | Available Pieces prominence | ✅ |
| K-14.2 | Category filter after party selection | ✅ |
| K-14.3 | Download selection popup (PDF/Excel honour it) | ✅ |
| K-14.4 | Rate List Settings area | ✅ |
| K-14.5 | Pieces/Size per category | ✅ |
| K-14.6 | Price combinations + equal-rate validation | ✅ |
| K-14.7 | Default rate list configuration | ✅ |
| K-14.8 | Party-specific configuration | ✅ |
| K-14.9 | Inactive products excluded everywhere | ✅ |
| K-14.10 | Inactive designs excluded everywhere | ✅ |
| K-14.11 | A4 portrait PDF | ✅ |
| K-14.12 | PDF logo (now the logo uploaded in Settings) | ✅ |
| K-14.13 | Row + column lines on the PDF | ✅ |
| K-14.14 | Multi-page header | ✅ |

## §15–§17 Design Rate List, Our Rate, Special Rates

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-15 | Design rate list follows settings; design combinations | 🟡 Partly | Inclusion/exclusion and `includeDesigns` honoured; individual rates preserved. **Blocked on K-18-style question:** a design record has no size field and the design section has one rate column, so "Size display" and "combined design column" have no defined meaning yet. |
| K-16 | Customer Rate vs Our/Self Rate | ✅ | "Compare our rate" toggle — shows our rate and the adjustment under any adjusted figure. |
| K-17.1 | Consolidated Special Rate view | ✅ | Special Rates tab: every rule, what it applies to, items affected (clickable → the actual products with old and new rates), our price vs theirs. |
| K-17.2 | Special rate adjustment shown | ✅ | Signed, green = customer pays more, red = discount. |

## §19 Collaboration tracker

| Ticket | Item | Status | Notes |
|---|---|---|---|
| K-19 | Ticket system with status flow + history | ⬜ Open | This file is the interim tracker. A built-in module is a larger piece — worth deciding whether it belongs in the software or stays a shared document. |
