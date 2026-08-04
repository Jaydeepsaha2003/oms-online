# Challan duplicate prevention — design

Date: 2026-08-04
Status: approved, awaiting implementation plan
Scope: **Challans only.** Orders and Dispatches are explicitly out of scope for now.

## Problem

On 2026-08-04 a scrap challan for UTTAM METAL was saved successfully as
`SSS/26-27/490` (id 1932), but the operator never saw the success screen and
believed it had failed. Every retry then returned a bare `400`, so the challan
looked permanently unsaveable while in fact it was already in the database.

Three separate defects combined:

1. **The success state never reached the operator.** The exact cause is not
   known (the operator does not recall whether an error appeared). The two
   plausible paths are a lost response over the router's OpenVPN — `api.ts`
   deliberately does not retry writes, because replaying a write could post a
   second challan — or a UI failure to render the success screen. The design
   must be safe under either.

2. **A debounced-autosave race resurrected the saved challan as a draft.**
   Autosave is debounced 800 ms; a save landing within that window left a timer
   pending which fired *after* `onSuccess` had cleared the draft, rewriting it.
   *(Already fixed separately: `savedId` now gates the autosave effect.)*

3. **The reason for the 400 was invisible.** The form surfaced
   `AxiosError.message` ("Request failed with status code 400"); the real
   message sat unread in the response body; and the API only logged `>= 500`.
   *(Already fixed separately.)*

This design addresses the remaining gap: nothing detects that a challan being
saved is a duplicate of one that already exists.

## Goals

- Warn before creating a challan that duplicates an existing one.
- Make the already-saved challan reachable in one click, so a lost response can
  never again look like a failed save.
- Never silently block a legitimate second challan for the same party and goods.

## Non-goals

- **Idempotency keys.** The correct general fix for lost responses, but the
  "Open existing challan" action already produces the right outcome for the
  observed failure. Larger change; revisit if duplicates persist.
- **Concurrency safety.** Two genuinely simultaneous saves could both pass the
  check. Rare in a single-operator shop, and the invoice-number unique
  constraint still catches identical codes. Accepted limitation.
- **Orders and Dispatches.** Dispatch already has a 15 s content dedupe
  (`DISPATCH_DEDUPE_WINDOW_MS`); it stays exactly as it is. Extending this
  design to Orders and Dispatches is deliberate future work.

## Detection rules

Two **independent** checks. Invoice number is an OR trigger, not an additional
required condition — as an AND it would only ever catch what the unique
constraint already catches, and would have missed the UTTAM METAL case had the
number been auto-assigned.

### Check 1 — invoice number already used (hard block)

Existing behaviour, retained unchanged: `assertCodeAvailable` throws
`BadRequestException` when a manually-typed code is taken. This **cannot** be
overridden — `Challan.code` is unique in the database, so "save anyway" is not
physically possible. The message is already specific and now reaches the UI.

### Check 2 — content match (warn and confirm)

Warn when an existing challan matches **all** of:

| Field | Comparison |
|---|---|
| Party | `customerName`, trimmed and upper-cased |
| Invoice date | same UTC calendar day — match the half-open range `[dayStart, dayStart + 1 day)`, not exact equality (the form sends midnight UTC today, but a range stays correct for rows written any other way) |
| Line items | same count; matched as a multiset on `productName`, `design`, `bags`, `pcs`, `kgs`, `box`, `price`, `amount` |
| Totals | `total`, `b`, `c`, each rounded to 2dp |

Exclusions:

- Challans with `challanStatus === 'CANCELLED'` — re-entering after a
  cancellation is legitimate.
- On edit, the challan being edited.

**Lookback is the same invoice date only.** Accidental double-entry is always
same-day; a wider window would fire on regular parties reordering the same goods
and train the operator to click past the warning.

Candidates are compared in memory, mirroring how `dispatch.service.ts` does it.
The candidate set (one party, one date) is tiny, so **no schema migration and no
fingerprint column are needed.**

## Flow

```
POST /challans  (or PUT /challans/:id)
  │
  ├─ invoice number taken?           → 400  (hard block, unchanged)
  │
  ├─ content match && !confirmDuplicate
  │                                   → 409  DUPLICATE_CHALLAN + match details
  │                                          │
  │                                          ├─ "Open existing challan" → navigate to its bill page
  │                                          ├─ "Save anyway"           → resend with confirmDuplicate: true
  │                                          └─ "Cancel"                → stay on the form
  │
  └─ otherwise                        → 201 / 200 as today
```

`409 Conflict` is used rather than `400` so the client can distinguish a
duplicate from a validation failure, and so it is legible in the new 4xx log
line.

## Changes required

### `packages/shared`

- `ApiError`: add optional `duplicate?: { id: number; code: string; customerName: string; invDate: string; total: number }`.
- `CreateChallanInput`: add optional `confirmDuplicate?: boolean`.

### `apps/api`

- `dto/challan.dto.ts` — add `@IsOptional() @IsBoolean() confirmDuplicate?: boolean` to the create and update DTOs. **Required:** the global
  `ValidationPipe` runs with `whitelist: true`, so an undeclared property is
  silently stripped and the flag would never arrive.
- `challans.service.ts` — add:
  - `private findDuplicateChallan(dto, excludeId?): Promise<Challan | null>`
  - `private challanContentMatches(candidate, dto): boolean`
  - call from `create()` and `update()` after the code check, before the insert.
  - Throw `new ConflictException({ message, error: 'DUPLICATE_CHALLAN', duplicate: {...} })`.
- `common/filters/http-exception.filter.ts` — pass a `duplicate` key on the
  exception response through to the `ApiError` payload (currently only
  `message`, `error` and `details` survive).

### `apps/web`

- `challan-form-page.tsx` — in `save()`'s `onError`, detect
  `status === 409 && error === 'DUPLICATE_CHALLAN'` and open the dialog instead
  of a toast.
- Reuse the existing `useConfirm`. Its `description` accepts a `ReactNode`, so
  the "Open existing challan" action lives inside the description and no new
  dialog component is needed:
  - title: `A matching challan already exists`
  - description: `SSS/26-27/490 · UTTAM METAL · same items · total ₹30,622` plus an "Open existing challan" button
  - confirmText: `Save anyway` → re-invokes the mutation with `confirmDuplicate: true`
  - cancelText: `Cancel`

## Error handling

- A 409 must **not** clear the local WIP draft — the operator may cancel and
  keep editing.
- "Save anyway" resends the identical payload plus the flag; it must not rebuild
  totals, so the confirmed record is exactly what was reviewed.
- If the duplicate lookup itself throws, the save proceeds. A detection failure
  must never block legitimate business entry.

## Verification

This repository has **no test framework**. Adding one (vitest) was offered and
is not currently in scope, so verification is manual plus read-only probes:

1. Unit-level: exercise `challanContentMatches` against the real UTTAM METAL
   payload captured on 2026-08-04 (party UTTAM METAL, 2026-08-04, S.S.STEEL
   SCRAP 364.55 KGS @ ₹70 = ₹25,518.5, total ₹30,622) and confirm it matches
   saved challan 1932.
2. Negative: change any single line quantity, price, or total and confirm it no
   longer matches.
3. Confirm a `CANCELLED` challan with identical content does not match.
4. Confirm editing challan 1932 does not flag itself.
5. End-to-end duplicate creation must be exercised against a scratch party, not
   live business data.
