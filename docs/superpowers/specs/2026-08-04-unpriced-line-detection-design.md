# Unpriced challan lines — detection, highlighting and blocking

Date: 2026-08-04
Status: approved, awaiting implementation plan
Scope: **Challans only** (Create Challan + Pending Challan). Orders are out of scope.

## Problem

Creating a challan for SHRI NARSINGH ENTERPRISES raised:

> Some rates are not set up for these items
> GLASS (PCS) — GST/Freight/Packing. They'll bill as ₹0 until added under
> Customer GST Rates / Transport Rates.

The warning is a transient toast that names a **product category**, not a line.
With three lines on screen the operator has to work out for themselves which row
`GLASS (PCS)` refers to. On a phone the toast is gone before that is possible.

Observed data for that party:

| Line | Category | gstRate | freightRate | packingRate |
|---|---|---|---|---|
| 7 HEXO DIAMOND HAMMER | `GLASS (PCS)` | `null` | `null` → later `200` | `null` |
| 6 JUCY | `GLASS` | 5 | 0 | 200 |
| 6 RAMPATRA | `GLASS` | 5 | 0 | 200 |

`GLASS` is configured; `GLASS (PCS)` is a different category and is not.

### Why this is worse than it looks

The challan carries **one** GST rate, computed as
`Math.max(0, ...items.map(i => n(i.gstRate)))` (`challans.service.ts:236`), with
`null` coerced to `0`. So an unpriced line does **not** bill at 0% — it silently
inherits the highest rate present on the other lines. In the case above the
challan bills everything at 5%, including the unpriced line.

That means the failure is invisible in the totals. If `GLASS (PCS)` should be
18%, the whole challan is under-rated at 5% and nothing on screen says so. Only
when *every* line is unpriced does GST collapse to 0 and become obvious.

Freight and packing behave differently — they are `bags × rate` summed per line
(`challans.service.ts:233-234`), so an unpriced line silently contributes ₹0.
Above, packing is ₹400 where it should be ₹600.

## Goals

- Show, on the line itself, which rate is missing — persistently, not as a toast.
- Surface it in Pending Challan, before the operator has spent time building a
  challan.
- Prevent a mis-rated challan from being saved.
- Let the operator fix the rate without losing the in-progress challan.

## Non-goals

- Orders and Dispatches.
- A "show only unpriced" filter on Pending Challan.
- Changing how the challan-level GST rate is derived (`Math.max`). It is
  surprising, but changing it is a separate pricing decision with its own risk.

## Detection rule

A line is **unpriced** when any of `gstRate`, `freightRate`, `packingRate` is
`null`.

`null` means the rate master holds no row for that category; `0` means
configured and genuinely zero. This distinction already exists
(`packages/shared/src/types/challan.ts:213`) and must be preserved — a
configured `0` must never flag.

## Create Challan

### Highlighting

- The row gets an amber tint.
- A badge on the row names exactly what is missing: `⚠ No GST · Packing rate`.
  Only the actually-missing rates are listed.
- The `GST%` cell shows a marker when `gstRate` is `null`, so an unconfigured
  line is visually distinct from a configured 0%.

Freight and packing have no per-row columns, so the badge is what carries them.

### Blocked save

Saving is blocked while any line is unpriced.

The Create Challan button stays **enabled**. Clicking it opens a dialog listing
the offending lines and their categories. A disabled button is rejected
deliberately: it hides the reason, which is the exact failure mode being fixed
elsewhere in this codebase.

Each distinct party + category in the dialog gets a **Set rates now** button.

### Inline fix dialog

Fields: GST %, Freight rate, Packing rate — prefilled with whatever is already
configured, blank for what is not.

On save:

1. `POST /gst-rates` and/or `POST /trans-rates` for that party + category.
2. Re-resolve rates and merge them into the existing rows **by `dispatchId`**,
   preserving operator edits to quantity and price.
3. `recalc` to update freight, packing and totals.

The operator never leaves the form.

### Permission fallback

`POST /gst-rates` requires `CREATE` on gst-rates; `/trans-rates` likewise
(`gst-rates.controller.ts:97`). An operator without those permissions who is
also blocked from saving would be trapped — unable to save and unable to fix.

Therefore: **when the user lacks rate-create permission, the block degrades to
warn-and-confirm**, and the dialog reads "Ask an admin to add rates for
GLASS (PCS)" instead of offering the inline form. Highlighting is unchanged.

## Pending Challan

`PendingChallanLine` gains `gstRate`, `freightRate`, `packingRate` (all
`number | null`).

`pending()` resolves them using the same `rateMaps` logic as `draft()`
(`challans.service.ts:204`), widened to accept the page's distinct customer
names so it stays two extra queries per page rather than one pair per line.
Transport name is per-customer and must be looked up alongside.

Affected rows show the same badge as Create Challan. No filter, no blocking —
Pending Challan is informational.

## Changes required

### `packages/shared`

- `PendingChallanLine`: add the three nullable rate fields.

### `apps/api`

- `challans.service.ts`
  - extract the existing per-line rate resolution so `pending()` and `draft()`
    share it;
  - widen `rateMaps` to accept multiple customer names;
  - populate the new fields in `pending()`.

### `apps/web`

- Replace `warnMissingRates` (`challan-form-page.tsx:100`) with a derived
  `unpricedLines` value — the toast becomes persistent row state. Keep a single
  toast on add for immediate feedback, but it is no longer the only signal.
- Row rendering: tint, badge, `GST%` marker.
- Blocking dialog + inline rate dialog.
- Pending Challan row badge.

## Edge cases

- A configured `0` must never flag.
- Manual lines need no special-casing: `addManual` always assigns concrete rates
  (`gstRate` falls back to the scrap rate or the draft's GST, freight and packing
  to `0` — `challan-form-page.tsx:399-403`), so they are never `null` and can
  never be flagged. Verify this still holds rather than adding a manual-line
  exemption, which would be dead code.
- Editing an existing challan: the saved challan's own `gst` is used as a
  fallback (`challans.service.ts:551`), so an edit must not block on a line that
  was already billed.
- If rate resolution fails, do not block. A bug here must never stop invoicing.

## Verification

No test framework exists in this repository; verification is manual plus
read-only API probes.

1. `POST /challans/draft` for SHRI NARSINGH ENTERPRISES returns one line with
   `gstRate: null` — confirm exactly that row is flagged and lines 2 and 3 are
   not.
2. A category with a configured `0` does not flag.
3. A scrap party (manual lines only, no `pCategory`) is not blocked.
4. An operator without rate-create permission sees warn-and-confirm, not a block.
5. Pending Challan flags the same line before it is added to any challan.
6. After the inline fix, quantity/price edits made before the fix survive.
