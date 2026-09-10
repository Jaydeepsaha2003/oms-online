# Unified booking order entry: proposed design and delivery plan

Status: planning only; no application or database changes made.

## Goal and confirmed decision

Enter items from a bag booking directly in the normal New Order form, with its existing editing, quantity calculations, design selection, photos and totals. Keep the booking's agreed rate basis and quantity balance intact.

The user confirmed: **create a new dated order for every later item request, with all those orders linked to the same booking.** Do not append these requests to the old order number. This removes the need for a new item-date field or date migration for this workflow.

## Findings from the current application

- BKG-00002 belongs to CHAITANYA STAINLESS STEEL. It reserves 300 GLASS bags / 21,000 kg at the booking date of 18 June 2026.
- At inspection, 1 bag / 70 kg was linked to ORD-1202, with one dispatch record on that line. The saved booking balance was therefore 299 bags / 20,930 kg. This is a snapshot, not a value to hard-code.
- Order lines already have `bookingId`; booking balances and history aggregate lines across orders. The single `Booking.orderId` field is not the complete list of linked orders.
- `Order.orderDate` already stores a separate date for each new order. The booking date drives historical chart pricing and snapshotted customer special rates.
- `BookingDrawSheet` duplicates item selection, quantity calculation, validation and a temporary item list. It supports some calculations, but lacks row editing and differs from the main form's Box-clear behavior and calculation-unit fallback.
- The main form explicitly prevents editing any booking-linked line, even before saving. Freezing the price has been implemented as locking the whole line.
- The popup offers a current-price choice, but only passes the resulting numbers and booking ID into the order. `OrdersService.applyBookingPricing` then overwrites them with booking-date prices. The preview and saved result can disagree.
- Order mutations refresh orders, dispatch and CRM queries, but do not invalidate booking queries. Booking availability can stay cached after a save.
- The normal order save route checks booking totals, but its checks do not match the standalone booking conversion route's category and booked-dimension rules. Availability checking and order writing are also separate operations.

Key source locations:

- `apps/web/src/features/orders/order-form-page.tsx`: normal entry, editing, drafts, save payload and current popup integration.
- `apps/web/src/features/orders/booking-draw-sheet.tsx`: duplicate editor and quote flow.
- `apps/web/src/features/orders/order-draft.ts`: local draft persistence.
- `apps/web/src/features/orders/use-orders.ts`: order mutations and query refresh.
- `apps/web/src/features/bookings/use-bookings.ts`: drawable bookings and quote API.
- `apps/web/src/features/bookings/bookings-page.tsx`: booking-to-order navigation.
- `apps/api/src/orders/orders.service.ts`: create/update, dispatch protections, pricing and booking capacity checks.
- `apps/api/src/bookings/bookings.service.ts`: historical pricing, remaining capacity, recomputation and history.
- `packages/shared/src/types/booking.ts`: booking contracts and `withinBooked`.

## Options considered

| Approach | Result | Trade-off |
| --- | --- | --- |
| **Recommended: booking selection inside New Order** | One item editor and one added-items table, with a booking as the source of rates and reserved quantity | Requires connecting booking quotes and capacity checks to the existing editor |
| Keep the popup and add its missing features | Similar appearance to today, with editing and more calculations | Retains two editors that can drift again, plus the extra Add-to-order step |

The booking reservation screen remains available for creating reservations and reviewing their history. Only the nested item-entry popup is replaced in the normal order workflow.

## Proposed user flow

1. Open New Order and select Chaitanya.
2. Set **Order date** to the date Chaitanya sent this particular list. Default to today, with helper text explaining that it is the customer's request date.
3. Show a compact booking section above the existing item-entry row when eligible bookings are available. Offer **Regular order — current rates** and **Use bag booking**, with booking number, booking date and available quantity visible.
4. For one eligible booking, prefill its ID when the user selects Use bag booking. For several bookings, require an explicit choice. Selecting the party alone must not silently turn a regular order into a booking draw.
5. Show the selected booking inline, for example: **BKG-00002 · Rates from 18/06/26 · 299 bags available**.
6. Add items through the existing New Order fields and table. Product/design rate values come from the booking quote; quantities, remarks, priority, design names and photos use the same controls as ordinary entries.
7. After Add, retain the selected booking for the next item. The entry clears using the normal form behavior. Each added line records its own booking ID and shows a booking badge.
8. Edit or remove a newly added booking item in the same table before saving. Update recalculates its quote and quantity impact. Cancel edit restores the original row.
9. Save creates a new order with the chosen Order date. Booking history gains this order and its lines; the remaining balance refreshes immediately.
10. Repeat for the next dated request. Earlier orders and dispatch records retain their identities and dates.

The header date applies to every item in this new order. If the operator is entering requests received on different dates, finish one dated order and then start the next.

## Dates and rates

| Value | Meaning | Behavior |
| --- | --- | --- |
| Booking date | Basis of the reserved price list | Read-only in New Order; unchanged by selecting an Order date |
| Order date | When the customer sent this list of items | Editable on the new order; saved and displayed through existing order-date fields |
| Created timestamp | When the operator entered the record | Existing system timestamp; never repurposed as the customer's request date |

For example, an order requested in September can use rates from BKG-00002's 18 June booking without changing the original June order.

**Proposed pricing rule:** a booking-linked line uses the frozen booking rate, visibly labeled and read-only; regular lines retain the ordinary pricing behavior. Current rates may be displayed for comparison but must not be offered as a selectable booking rate unless that choice is explicitly supported and persisted by the backend. Supporting a separate override while still consuming the booking is outside this initial proposal.

Re-quote when an item's pricing identity or booking changes. Quantity-only changes update the amount. Never queue or save a line with an unresolved quote, a quote from a previously selected item, or zero substituted because the quote request failed. Display a retry action on quote failure and keep entered quantities intact.

## Editing and calculation behavior

- Reuse the main form's item entry; do not copy its handlers into a second editor.
- Bags to kg uses the customer's category bag weight. Pcs to kg uses the product's piece weight. Pcs and Box use the product's pack size. Preserve the main form's behavior when Box is cleared and its manual quantity overrides.
- Use the same category billing unit, rounding, required fields, duplicate warning, design-name rules, blocked-logo rules, keyboard navigation, photos and amount calculation as normal order entry.
- If a conversion factor is missing, leave the dependent field available for manual entry; do not invent a weight or pack size.
- Remove the blanket booking lock only for unsaved lines in this form. Saved order lines continue through the existing Order Modify workflow and its dispatch protections.
- When editing a saved booking line through Order Modify, resolve prices from its booking, not from the later order date. Preserve restrictions on changing dispatched identity/rates and on reducing quantities below shipped quantities.
- Changing the entry's booking affects that entry and subsequent additions. It must not silently change previously added rows. Switching customer clears incompatible booking context through the existing form reset/confirmation behavior.

## Quantity balance and saving

Display three distinct figures for the selected booking: **available before this order**, **used in this order**, and **available after saving**. Display bags and kg only as constrained dimensions where those dimensions were reserved.

With the inspected balance, adding 3 + 2 bags to a new order previews 299 - 5 = **294 bags left**. Before saving, this is a local preview. Saved allocations already include earlier dispatched lines; dispatching those lines must not subtract their booked quantity a second time. Existing dispatch overage withdrawals still count under the current overage rules.

Rules to enforce in both client feedback and the authoritative save path:

- Validate that each selected booking belongs to the order's party and has a drawable status.
- Check the total reservation and applicable category allocation. Preserve the application's existing support for reservations without a specified category.
- Apply `withinBooked` consistently so a bags-only reservation is not rejected for having derived kg.
- Include all live allocations across orders and existing overage withdrawals; account for preclosed quantities.
- When replacing or editing a row, count the proposed quantity once. Do not count both the original and edited versions, or subtract saved lines twice while reopening a saved draft.
- Recheck capacity at save time and keep the capacity check, order write and booking accounting consistent under concurrent saves. A stale balance must produce a clear remaining-quantity error and retain the user's entered items.
- Refresh booking queries after create, update, cancellation, deletion and restore operations that affect allocation.

Local unsaved drafts only preview usage. Retain the current saved-DRAFT reservation policy rather than changing when saved drafts consume booking capacity. Restore the selected booking, linked line IDs and Order date when reopening a draft, then revalidate eligibility and balance.

## Compatibility and scope

- No new date column or database migration is needed for the confirmed new-order-per-request design.
- Do not merge, backdate, reprice or move existing orders/dispatches as part of this change.
- Booking history and PDFs must list all linked order numbers with each order's own date. Continue aggregating through line links and conversion history, not only `Booking.orderId`.
- From Bag Bookings, replace the current Convert navigation with New order using booking. Pass both customer and the specific booking ID so the selected booking cannot silently become the first booking in a list.
- Preserve old navigation entry points with redirects/adapters to the unified form where necessary. Do not remove backend conversion endpoints until callers are accounted for.
- Preserve regular order, quotation and Create & Dispatch behavior. Quotation creation must not silently retain a booking draw; require regular-order mode or a deliberately supported conversion policy.
- All ordinary item-entry features remain available; actions that conflict with booking accounting must explain that restriction.

## Delivery sequence

### 1. Establish pricing and capacity contracts

Work in `orders.service.ts`, `bookings.service.ts` and the existing shared booking types. Reuse the booking-date quote operation; unify ownership, status, category and dimensional checks for normal order saves. Make the server consistently preserve the displayed booking basis and protect simultaneous draws. Cover creation, updates and reopening saved drafts.

Validate with isolated fixtures: booking for another party; exhausted, cancelled and preclosed bookings; total/category overflow; bags-only and kg-only bookings; replacing an existing row; dispatch overages; and two saves attempting to consume the same last balance.

### 2. Connect the normal item editor to bookings

Modify `order-form-page.tsx`; add a small `order-booking-source.tsx` for the selector/summary and `use-order-booking-entry.ts` for booking quote state and local allocation preview. Keep ordinary quantity and entry behavior in the existing form rather than introducing another editor.

Retain source identity per item, allow editing unsaved booking lines, prevent stale asynchronous quote results, display frozen rates and live amounts, and preserve keyboard and photo behavior. Remove the nested editor from this page after feature parity is verified.

### 3. Complete navigation, drafts and refresh

Update `bookings-page.tsx`, `use-orders.ts`, `use-bookings.ts` and `order-draft.ts` with specific-booking navigation, booking-query invalidation and backward-compatible draft restoration. Restore only optional new frontend context; old drafts must remain readable. Handle a restored booking that has closed or been consumed elsewhere with a visible correction path.

### 4. Verify downstream views and saved-line editing

Review `order-modify-page.tsx` and booking history/PDF projections. Ensure booking pricing stays anchored to the booking when item identity changes, and keep dispatch restrictions. Check that multiple dated orders appear under the same booking and each new order is independently available for dispatch.

### 5. End-to-end checks and delivery

Use fixture data for mutation tests; do not consume Chaitanya's real booking to test the change.

- Create a booking for 300 bags / 21,000 kg dated 18 June, with 1 bag already allocated and dispatched on an existing order.
- Start a new order with a later request date. Choose the same booking and add 3 bags and 2 bags; verify 210 kg and 140 kg where the customer has 70 kg per bag configured, and 294 bags / 20,580 kg remaining after the proposed draw.
- Edit 3 bags to 4; verify only the extra bag is counted. Cancel an edit and remove a row; verify the previous balance restores correctly.
- Change today's product/special rates in fixtures. Booking lines must display and save the booking basis; a different Order date must not change that basis.
- Save two orders on different dates against the same booking. Reopen both; verify dates, rates, quantities and the combined remaining balance. Verify the original dispatch is unchanged.
- Verify ordinary order entry, Box-clear restoration, calculation factors, photos, duplicate warnings, keyboard navigation, local drafts, saved drafts and Create & Dispatch.
- Test failed quotes, out-of-order quote responses, booking/customer changes, capacity exhaustion by another operator and repeated save clicks.
- Confirm regular quotations still work and booking allocation cannot accidentally be created by a quotation action.
- Run shared/API/web type checks and relevant builds. Inspect the form on desktop and a narrow viewport.
- Build the frontend served by the running application and verify the server references the new bundle. If API code changes, use the repository's existing restart procedure and verify the updated endpoint behavior. Report the need to refresh an already-open browser tab.

## Recommendation

Proceed with the unified New Order form. Use the existing Order date for each new request and retain BKG-00002 as the common reservation and pricing link. Improving the popup would leave the main cause of feature drift in place.
