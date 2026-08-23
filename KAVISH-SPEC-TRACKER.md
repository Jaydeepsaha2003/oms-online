# Kavish Steel — Change Spec Tracker

Every item from `Kavish_Steel_Full_Software_Change_Spec.md`, written as
**what was wrong → what I changed → a real example from your own data**, plus where to
click to check it. Statuses follow §19.4 of the spec.

**Status key:** ⬜ Open · 🔵 In Progress · ✅ Developer Completed · 🟢 Verified by owner ·
🟡 Partly done · ❓ Needs owner answer · 🔁 Reopened

**Last updated:** 23 Aug 2026

**Examples taken from** a read-only copy of the live database on 23 Aug 2026
(1,967 challans · 1,235 orders · 4,072 dispatches · 317 products · 115 billed parties ·
52 transporters · 5 users). The live file was never written to.

---

## Summary

| Status | Count | Tickets |
|---|---|---|
| ✅ Developer Completed | 40 | K-2.1, K-2.2, K-3.1, K-4.1, K-4.2, K-4.3, K-5.1, K-5.2, K-6.1, K-6.2, K-7.1, K-8, K-9.1, K-10.1, K-11.1, K-12.2, K-13.1, K-14.1 … K-14.14, K-16, K-17.1, K-17.2, PD-1 … PD-6 |
| 🔵 In Progress | 0 | — |
| ⬜ Open | 1 | K-19 |
| 🟡 Partly done | 1 | K-15 |
| ❓ Needs owner answer | 3 | K-9.2, K-12.1, K-18 |

**Not yet deployed.** Two additive migrations are waiting — `20260822190000_product_changes`
and `20260823090000_user_preferences`. Run `npm run db:deploy`, then `restart.bat`.
Neither alters anything that already exists.

---

## ❓ Still blocked on you — 3 items

I stopped rather than guess on these, because guessing means writing a wrong business rule.

### K-9.2 · Design form full redesign
Awaiting your UltraWeb / call session. Nothing to decide in writing.

### K-12.1 · CRM follow-up reminders not appearing
**What I need** — one concrete case: which reminder, where you expected it, when, and
what you saw instead.
**Read PD-3 first.** I found and fixed a real reminder defect in this same area, and it
may well be your problem. Also worth knowing: your `followups` table holds exactly **one
row**, a DELIVERY already marked DONE — so there may simply have been nothing due to
remind about. Please re-test after the restart before we dig further.

### K-18 · "Rate of Design on Cup per KG", Ghungroo, Amri
**What I found** — GUNGROO exists: a design type under CUP, ₹3, across two
sub-categories. **AMRI does not exist anywhere in the data.** The nearest names are:

`AMRAPALI` · `AMRAPALI DELUX` · `AMRAPALI DELUX SPECIAL` · `AMRAPALI DELUX UNPOLISHED (26 G)` ·
`AMRAPALI NANO` · `AMRAPALI SPECIAL` · `AMRAPALI SPECIAL UNPOLISH` · `DAMRU` · `DAMRU CUP`

**What I need from you** — which one you meant, and confirmation that CUP design rates
are a **per-kg addition** on top of the product rate.

---

## ✅ Answered from the code — no change was needed

### K-4.2 · What are Packing / Freight on the Transporter form for?
They are a **default copied onto a Customer at import time**
(`customers.service.ts`: `packing ?? transporter?.packing`). They are never read while
pricing a challan.
**Live example** — 27 of your 52 transporters carry a non-zero figure.
**Superseded by K-4.3** — you decided they are not needed, and they are now hidden from
the Transporters screen. The stored values are untouched.

### K-5.1 · Transporter vs Transporter Rates — which is the source of truth?
**`trans_rates` is.** Challan pricing reads it (`type IN ('FREIGHT','PACKING')`,
preferring the row that matches the transporter).
**Live example** — 640 rows in `trans_rates`. Because the Transporter fields only seed
*new* customers, a difference between the two screens can never mis-price a challan.

### K-6.2 · What does "Select all (318 matching)" mean?
Every product matching your **current search and filters, across all pages**, fetched on
demand. The header checkbox beside it selects only the **page you are looking at**. The
selection survives page turns, so you can build a set up before acting on it.
**Live example** — the catalogue holds 317 products today, so with no filters that
button now reads "Select all (317 matching)".

### K-9.1 · What is the checkbox in the Designs Actions column?
It is **show on rate list** — the same control Products has. Deliberately separate from
Active: Active means *usable on an order*; show-on-rate-list means *appears on the
printed sheet*. A design can be active but kept off the sheet.
**Live example** — 266 of 317 products are on the rate list while all 317 are active.
That gap of 51 is this setting doing its job.

---

## §2 · Login, Access & Notifications

### K-2.1 · Two notification bells → one ✅
**Before** — two bell icons sat side by side in the topbar. One was the CRM bell; the
other existed only to enrol this device for push. Two icons, one of which most people
never understood.
**After** — one bell. Device enrolment moved **inside** the popover as a dismissible band
at the top. Users who cannot read CRM still get a bell purely so they can enrol, and for
them it disappears once the device is enrolled. Split into two components so CRM queries
never fire for a user without `crm:view`.
**Where to check** — top-right of any page.

### K-2.2 · Operators were still landing on the Dashboard ✅
**What you reported** — every other user is an Operator, you did not give Operators
Dashboard access, and they land on the Dashboard anyway.

**You were right and my first answer was wrong.** I checked `admin`, `manager` and
`viewer` and reported that all your roles hold `dashboard:view`. I missed the
**`operator`** role entirely — it is the one four of your five users actually have.

**What I found, in order:**

1. In the database the Operator role holds exactly four permissions —
   `dispatch:view`, `dispatch:create`, `dispatch:update`, `dispatch:delete`.
   **No `dashboard:view`.** Your setup was correct all along.
2. Running the app's own routing against that exact list: `dashboard:view` → **false**,
   and "/" resolves to **`/dispatch/new`**. So the front-end is correct too.
3. So why were they on the Dashboard? **Because changing a role's permissions did
   nothing to anyone already signed in.** `RolesService.update` rewrote the grants and
   stopped there — it never invalidated a single live session. A signed-in client holds
   the permission list it was given when its session was issued, and keeps using it.
4. Your four Operators still carry `tokenVersion = 0` — never invalidated once — on
   sessions created **5–10 August**. They have been running on a permission list that is
   two to three weeks old. When you took the Dashboard away, it never reached them.

**The fix** — editing a role's permissions now bumps `tokenVersion` for every user
holding that role, and changing which roles a user holds bumps theirs. Their next
request returns 401, the client refreshes transparently, and the refresh re-reads
permissions from the database — so the new rules land within a second.
**Nobody is signed out.** The bump invalidates the short-lived *access* token only;
`/auth/refresh` does not check `tokenVersion` and their refresh token is untouched. That
is deliberate — it has to be harmless enough to run on every permission edit.

**Verified against a copy of your database:** all 4 Operators bumped 0 → 1, the
super-admin (not in that role) untouched at 3, and all 6 of their refresh tokens still
valid — so they stay logged in.

**To fix the four accounts that are already stale**, after the restart open
**Administration → Roles & Permissions → Operator → Save**. No change needed; saving is
enough, and all four pick up the correct permissions on their next tap. (Alternatively,
Users → Sign out of every device, but that makes them log in again.)

**Where to check** — have an Operator open the app. They should land on **Dispatch
Order**, and the Dashboard should not be in their menu.

---

## §3 · Global Form Header

### K-3.1 · The page title was printed twice ✅
**Before** — the global header already showed the page name, then the page printed it
again immediately underneath with the same icon. A whole row of screen wasted, on every
page, at every screen size.
**After** — removed on **12 pages**: Users, Approvals, Activity Log, Bag Bookings, Price
History, Party Lists, Settings, Special Rates, Manage Cheques, Roles & Permissions,
Agents, Quotations. Only the repeated icon and the heading went — **every subtitle (the
live record counts) and every action button was kept**.
**Deliberately left alone** — New Booking, Convert Booking, Follow-ups and the Payment
Desk show a record-specific title the topbar does *not* show; removing it there would
lose information.
**Also** — 9 icon imports left dead by the removal were cleaned up.
**Where to check** — Administration → Users. The list starts one row higher.

---

## §4–§5 · Transporter & Transporter Rates

### K-4.1 · Customer count → clickable, and it was wrong ✅
**Before** — the Transporters list showed a customer count you could not click, so there
was no way to see *which* customers. Worse: **the count included closed (inactive)
accounts**, so every transporter was overstated against a column that reads as current
business.
**After** — the count opens a popup listing party, agent, city/state and mobile, and it
counts **active customers only**, matching what the column claims. The list is fetched
only when you open it.

**Live example — the transporters that were overstated:**

| Transporter | Count shown before | Count shown now | Closed accounts it was hiding |
|---|---|---|---|
| SELF | 19 | 18 | 1 |
| MAHAVEER TRANSPORT | 14 | 13 | 1 |
| SAURASHTRA ROADWAYS | 13 | 11 | 2 |
| KERALA ROADWAYS | 1 | **0** | 1 |
| NEW SK TRANSPORT | 1 | **0** | 1 |

The last two are the clearest: both looked like live transporters with a customer. They
have none — the only party on each is closed.
**Where to check** — Transporters → click any number in the customers column.

### K-5.2 · "Recent changes" beside Bulk rate change ✅
**Before** — after a bulk rate change there was no way to see what the run actually did.
The only history was a per-row icon showing one rate's trail, which answers a different
question — "what happened to *this* rate", not "what did I just change".
**After** — a **Recent changes** button beside Bulk rate change opens a dialog listing
Party, Category, Type, Transporter, old → new, the **change amount**, date/time and user,
newest first. **No migration was needed** — `rate_history` already stored exactly these
fields and the endpoint already returned them; nothing was reading it. The per-row
History icon is untouched.

**Live example — the three most recent rows in your data:**

| Party | Category | Type | Transporter | Old → New | Change |
|---|---|---|---|---|---|
| KEERTHIKA STAINLESS | GLASS | — | — | ₹50 → ₹5 | −₹45 |
| KEERTHIKA STAINLESS | GLASS | — | — | ₹5 → ₹50 | +₹45 |
| SHRI NARSINGH ENTERPRISES | GLASS (PCS) | PACKING | SURAJ TRANSPORT | ₹0 → ₹200 | +₹200 |

Read together, those first two rows say someone dropped KEERTHIKA from ₹50 to ₹5 and put
it back. That round trip was invisible before this screen existed. (12 rows in total —
the trail only starts from when the table began being written.)
**Where to check** — Transporter Rates → Recent changes.

### K-4.3 · Packing and Freight removed from the Transporters screen ✅
**Your call** — "we are already using the transporter rates per customer, it's safe to
remove". Agreed, and it matches what I found in K-4.2 / K-5.1: challan pricing reads
`trans_rates` and has **never** read these two fields. Their only job was to seed a newly
imported customer. An editable figure that prices nothing is a trap — someone corrects
freight here and cannot understand why the challan does not change.
**Removed from** — the list columns, the mobile card, and the add/edit form.
**Not removed** — the two database columns. Nothing is deleted, and the edit form omits
them from the payload rather than blanking them, so every stored value survives
untouched. Dropping columns is irreversible; say the word and I will, separately.
**One consequence worth knowing** — a transporter created from now on has no
packing/freight figure, so a customer imported under it starts blank and takes its
pricing from Transporter Rates. That is the behaviour you asked for.
**Where to check** — Transporters. The two columns are gone; Customers is now beside
Transport name.

---

## §6–§7 · Products & Product Photos

### K-6.1 · Product "Recent changes" ✅
**Before** — `product_rate_history` only ever recorded the **rate**. Rename a product,
move it to another sub-category, change its size, pcs or weight, switch it off the rate
list — none of that was written anywhere. There was no way to answer "who changed this,
and when".
**After** — a new `product_changes` table (**migration `20260822190000_product_changes`**)
logs every *other* field — name, category, sub-category, size, pcs, weight, active,
show-on-rate-list — **one row per field**, with old → new, who, and when. A **Recent
changes** button on the Products toolbar shows it.
**Deliberately not duplicated** — rate changes keep their own separate trail, because
booking-date repricing depends on that table. The new trail also survives the product
being deleted, so a deletion cannot erase its own history.
**Live example of what it will now catch** — the gap between 317 active products and 266
on the rate list means 51 products have been switched off the sheet at some point. Not
one of those 51 switches was recorded before this change.
**Where to check** — Products → Recent changes. The trail starts from the restart; it
cannot show changes made before the table existed.

### K-7.1 · Product Photos date fields cut off ✅
**Before** — the From / To date inputs carried `flex-1 min-w-0`, which let them shrink
**below the width a native date field needs**. The `dd-mm-yyyy` segments clipped and ran
into the calendar icon, so you could not read the date you had just picked.
**After** — given a width that fits their own content. On a narrow screen the row now
**wraps** instead of crushing the fields. Screen-reader labels added.
**Where to check** — Product Photos → the From / To filters, then narrow the window.

---

## §8 · Search & Combo-box UI

### K-8 · Standardise the search / combo-box treatment ✅
**Your clarification** — the combo-boxes should look like the search boxes too, and the
"All Parties" / "All Products" text should be clearly visible.

**Before** — a combo-box wore the same hairline border as an ordinary text field, so a
field you can *search* looked identical to one you can only type into. And a filter
sitting on "All parties" showed that text in the faint **placeholder** grey, as if the
field were empty.

**After — the border.** Every combo-box in the app now wears the same thick navy edge as
the search boxes, with the matching navy focus ring, the red border when a value is
rejected, and — deliberately — a *thin* grey border when the field is disabled, because a
field you cannot use should not be the loudest thing on the form.

**After — the "All Parties" text.** This was a real mistake, not just a colour choice.
The placeholder grey is deliberately faint so a placeholder reads as **absent**. But on a
filter, "" is not absent — it is a genuine choice meaning *everything*, and "All parties"
is the filter's current state. It now reads as ordinary text, and so does that row in the
dropdown list.

**It works this out for itself.** A filter is built as `options={['', …list]}` — the bare
"" row is what clears it. Where that "" option exists, the placeholder is the state and is
shown in full; where it does not, the placeholder is a true hint ("Type the party
name…") and stays faint. No call site had to be touched, and one written next month
behaves correctly on its own.

**Live example** — 126 combo-boxes in the app are built this way, across 18 distinct
labels: *All parties · All products · All customers · All categories · All designs · All
design names · All agents · All items · All order IDs · All priorities · All due · All
Dr / Cr* and more. Every one of them was greyed out; every one now reads clearly.

**How it is applied** — through the stylesheet on a `data-slot="combobox"` marker, not
through the component's own classes. Around **220 call sites** pass their own
`className` and many carry borders of their own, which would have won the merge and left
a scattering of odd-looking fields. Plain unlayered CSS does not lose that fight, so they
all match — the same tactic that already keeps the ~35 search boxes consistent.
**Also** — the chevron is no longer half-faded and now turns over when the list is open,
so the field shows its own state.
**Where to check** — any list page's filter row: Challans, Orders, Party Ledger,
Products. The filters should carry the navy edge, and "All parties" should be as readable
as a chosen party name.

---

## §10–§11 · Order Form & Challan

### K-10.1 · "Select a customer" nagged you on open ✅
**Before** — opening a new order immediately told you to select a customer, before you
had done anything. A warning about a step you had not reached yet.
**After** — nothing on open. The prompt appears when you reach for the item area, and
stays until a customer is picked — which is the moment it actually matters.
**Where to check** — Orders → New order.

### K-11.1 · Party filter on the challan item-wise search ✅
**Before** — picking an item showed its entire billing history across every party at
once. For a popular item that is an unreadable wall.
**After** — a **Party** dropdown narrows the history to one customer. It works
client-side (the rows are already loaded, so it is instant), it is offered **only when
the item actually has more than one party**, and it resets when you change item. The
lines / qty / amount strip recomputes from the filtered rows, so the totals can never
contradict the table you are looking at.

**Live example — your worst offenders:**

| Item | Parties in its history | Challan lines |
|---|---|---|
| 8 ROYAL CUP | 16 | 45 |
| 5.5 RAMPATRA | 16 | 59 |
| 5.5 FLOWER POT CUP | 15 | 49 |

Look up `5.5 RAMPATRA` and you used to get 59 lines in one list. Now you can cut it to
one party.
**Where to check** — Challans → item-wise search → pick `5.5 RAMPATRA`.

---

## §12 · CRM

### K-12.2 · New Inquiry panel ✅
**Before** — an enquiry ("they asked about X, I said I'd come back Tuesday") had nowhere
to live. It got recorded as a delivery follow-up, or not at all.
**After** — built as **option (a)**, which you chose: `INQUIRY` is a **third follow-up
kind**, not a parallel model. An enquiry has a party, a promised date, a reminder loop
and a timeline — all of which already existed — so it reuses the entire machinery
(reminders, checklist, party links, timeline) instead of duplicating it. New
**CRM → New Inquiries** page and menu entry at `/crm/inquiries`.
**Safety** — an unrecognised kind still falls back to DELIVERY, so an older phone with a
cached app cannot break.
**Verified** — all three kinds create and filter independently of each other.
**Where to check** — CRM → New Inquiries.

---

## Payment follow-up desk — direct request, 23 Aug 2026

### PD-1 · Show the exact B – Bank / C – Cash split ✅
**Before** — the open-invoice list under a follow-up showed only the balance. Which side
the invoice was billed on was not shown at all, so when you rang a party you could not
say which part you were chasing.
**After** — two new columns: **B / Bank** in blue, **C / Cash** in green, a dash where
that side is empty, and the full rupee figure on hover.

**Live example — the largest split invoices in your book:**

| Invoice | B / Bank | C / Cash | Total |
|---|---|---|---|
| SSS/1023 | ₹1,20,721 | ₹1,29,547 | ₹2,50,268 |
| SSS/1745 | ₹1,20,498 | ₹95,220 | ₹2,15,718 |
| SSS/651 | ₹1,33,488 | ₹66,096 | ₹1,99,584 |

**Why this mattered** — of your 1,967 challans, **1,123 are billed across both sides**,
764 are bank-only and 78 are cash-only. So for more than half the book, a single balance
figure was hiding the split entirely.
**Where to check** — CRM → Payment Recovery Desk → Collect → open invoices.

### PD-2 · Select multiple invoices ✅
**Before** — one **use** link per row. A party promising to clear three invoices at once
forced you to make three separate follow-ups.
**After** — a tick-box on every invoice row. A footer appears **only once something is
ticked** — so the single-invoice path is unchanged and no slower — showing how many are
selected, the B and C totals, the combined balance, and **Use selected**, which fills the
follow-up with all the picked invoice numbers and their total as one promise. The
selection is keyed by invoice code, so it survives the list reordering underneath it.
**Where to check** — same screen: tick two or three rows.

### PD-3 · Saving a follow-up fired a reminder instantly — real defect ✅
**Before** — you saved a follow-up and were immediately nudged about the thing you had
just typed.
**Cause** — `nextRemindAt` was left empty when the follow-up was created, and the
scheduler reads "no next reminder time" as **already due**. Every new follow-up was born
overdue.
**After** — the first reminder is set an **hour ahead** and clamped into working hours.
**Verified** — on create, `nextRemindAt` lands ~60 minutes out, and the follow-up does
**not** appear in the due list straight away.
**Note** — this may well be the cause of K-12.1. Please re-test that after the restart.

### PD-4 · Quiet hours (DND) for reminders, per user ✅
**Before** — no way to stop reminders reaching you at night. The only reminder controls
were app-wide.
**After** — **Settings → General → Reminder quiet hours**: a switch plus From / Until
times, with a "Quiet right now" badge when you are inside the window.
**Deliberately per user, not per installation** — the app-wide CRM settings decide *when
a follow-up becomes due*, which is a business rule and the same for everyone. This
decides whether *you personally* are disturbed by it. You and a floor operator keep
different hours.
**Nothing is lost** — a reminder landing inside your window is **delayed, not cancelled**.
It stays in CRM and on the bell and pushes once the window ends. If *everyone* is quiet,
nothing is marked as sent at all.
**Windows crossing midnight work** — 21:00 → 08:00 behaves as one night, not two.
**Verified** — default is off; saving muted only that one user (3 recipients → 2 awake);
invalid times are rejected; and a corrupted preference falls back to "not quiet" rather
than silencing someone forever.
**One honest limit** — when *some* recipients are quiet, the push goes to the rest and the
follow-up is marked as sent, which is per follow-up rather than per user. A sleeper
misses that particular ping; they still see the follow-up in CRM and on the bell, and it
re-fires on the next interval. Making that exact needs a per-user push ledger, which I
did not build.
**Where to check** — Settings → General → Reminder quiet hours.

### PD-6 · Quiet hours for the whole team, and per person ✅
**Before** — PD-4 gave each person their own quiet hours, but only they could set them.
There was no way to see who was reachable, or to set an evening for the whole floor
without asking four people to each go and do it.
**After** — **Settings → General → Team quiet hours**, for anyone who can already view
the user list. Every user is listed — including those who have never set anything, shown
as *not set, on the default*, so the screen is the whole staff list rather than the
handful who happened to configure it. The header reads *"2 of 5 on · 3 quiet right now"*,
and a **Quiet now** badge marks anyone currently inside their window.

**Two ways to work, because both are real:**
- **Per person** — flip one row's switch or change its times; it saves on its own.
- **Several at once** — tick people, set one From/Until, and **Apply to selected**, which
  is how a shift ("nobody after 21:00") actually gets set. **Turn off for selected** is
  the reverse.

**One window per person, not two.** The team screen writes the *same* record the person
edits in their own Settings — there is no company window layered over a personal one.
That is deliberate: two windows need a precedence rule, and a precedence rule is
something somebody has to remember at 11pm when a reminder does or does not arrive.
Whoever saves last wins, and that is the whole rule.

**Verified against a copy of your database — 12 checks, all passing:** all 5 users listed
(none configured yet, all on the default 21:00–08:00); setting one person writes only
their window; their own Settings card immediately reads the admin's edit (proving it is
one record); one window applied to 3 people at once; the 4th person untouched; at 22:30
the scheduler drops the quiet ones (**5 recipients → 2 awake**) and at 12:00 all 5 are
reachable again; 21:00–08:00 is read as one night not two; an invalid time and an unknown
user are both refused.

**Times are saved on blur, not per keystroke** — a time input emits a value as you type
each segment, so saving on change would write "0" before "09" and reject the first one.

**Where to check** — Settings → General → Team quiet hours.

### PD-5 · Dialog restyled to look like management software ✅
**Before** — the New payment follow-up dialog led with emoji tiles (👤 💰 💬 ⚡ 📦 ✅ 📅 🏭),
🙂 / 🔥 priority buttons and ✨ 🏭 🚚 ✅ stage chips. The party and order boxes had **no
labels at all** — you inferred them from the placeholder text. It read as a consumer app.
**After** — every emoji replaced with the line icons the rest of the app uses; emoji
render differently on every operating system and carry a colour we do not control. Each
question is now a proper form section: white panel, header bar with a small icon and an
uppercase caption, a rule, then the fields. **Every control gained a caption** — PARTY
NAME, LINKED ORDER, PROMISED AMOUNT, PROMISED BY, AGAINST. Wording tightened:
"How much & by when?" → **Payment commitment**, "Notes" → **Remarks**, "How urgent?" →
**Priority**, "Where is it now?" → **Current stage**, "More options" → **Advanced**.
Priority became one joined segmented control instead of two loose buttons. Selected chips
went from bright blue/indigo to neutral slate, so colour in this dialog now only means
something: rose = overdue or urgent, blue = bank, green = cash. The balance panel matches
— squared corners, hairline rules, tabular figures, and a selection bar that reads as a
totals row.
**Where to check** — CRM → Payment Recovery Desk → New payment follow-up.

---

## §13 · Administration — Users

### K-13.1 · "Active" did not mean the person is using the system ✅
**Before** — one **Status** column showing Active / Inactive. That is the *account* flag —
it says the login is allowed, not that anyone has used it. There was no way to tell a
daily user from an account nobody has touched in months.
**After** — the column is renamed **Account**, which is what it always meant, and a new
**Last active** column shows a green **"Using now"** for activity within 15 minutes,
otherwise relative time ("3 days ago"), or **"Never used"** — plus the number of open
sessions.
**The important detail** — activity is read from the **audit log (what they actually
did)**, not `lastLoginAt`. Someone who signs in at 9am and walks away has a recent login
and no recent activity; only the audit log tells those apart. Two batched queries, no N+1.
**Live example** — all 5 of your users are marked account-active. That single fact was
everything the old column could tell you; the new column separates them.
**Where to check** — Administration → Users.

---

## §14 · Rate List — completed earlier

| Ticket | Item | Status |
|---|---|---|
| K-14.1 | Available Pieces prominence | ✅ |
| K-14.2 | Category filter after party selection | ✅ |
| K-14.3 | Download selection popup (PDF/Excel honour it) | ✅ |
| K-14.4 | Rate List Settings area | ✅ |
| K-14.5 | Pieces / Size per category | ✅ |
| K-14.6 | Price combinations + equal-rate validation | ✅ |
| K-14.7 | Default rate list configuration | ✅ |
| K-14.8 | Party-specific configuration | ✅ |
| K-14.9 | Inactive products excluded everywhere | ✅ |
| K-14.10 | Inactive designs excluded everywhere | ✅ |
| K-14.11 | A4 portrait PDF | ✅ |
| K-14.12 | PDF logo (the logo uploaded in Settings) | ✅ |
| K-14.13 | Row + column lines on the PDF | ✅ |
| K-14.14 | Multi-page header | ✅ |

**Live example of what K-14.6 is doing** — GLASS `10-PCS-FG-22G` holds **47** rate-list
products spanning **₹320 to ₹405**. Instead of 47 rows, the sheet merges the ones that
share a rate and prints the spread. `8-PCS-FG-22G` behaves the same: 26 products,
₹320–₹405.
**Live example of K-14.9 / K-14.10** — 266 of 317 products carry show-on-rate-list; the
other 51 are excluded from the sheet, the PDF and the Excel alike.

---

## §15–§17 · Design Rate List, Our Rate, Special Rates

### K-15 · Design rate list follows settings; design combinations 🟡 Partly
**Done** — inclusion / exclusion and `includeDesigns` are honoured, and individual design
rates are preserved.
**Blocked** — a design record has **no size field**, and the design section has a single
rate column, so "Size display" and "combined design column" have no defined meaning yet.
Same shape of question as K-18: tell me what a design's size is and I can build it.

### K-16 · Customer Rate vs Our / Self Rate ✅
**Before** — the rate list showed the customer's price only. To see whether a party was
being charged above or below your own rate you had to look it up separately.
**After** — a **Compare our rate** toggle. With it on, any adjusted figure also shows your
rate and the adjustment underneath it.
**Where to check** — Rate List → Compare our rate.

### K-17.1 · Consolidated Special Rate view ✅
**Before** — special rates were visible only one party at a time, buried in that party's
form. There was no single place to see every rule in force.
**After** — a **Special Rates** tab listing every rule, what it applies to, how many items
it affects, and your price against theirs. **The item count is clickable** — it opens the
actual products affected, with their old and new rates.
**Live example** — **344 special-rate rules** exist across your customers. Two of them, on
the same customer: `CUP / 4-PCS-CUP-FG / FLOWER POT DOUBLE WALL` at **+₹2**, and
`GLASS / 12-PCS-FG-22G / DAMRU` at **+₹5**. Before this tab, seeing all 344 meant opening
customers one by one.
**Where to check** — Rate List → Special Rates, then click any item count.

### K-17.2 · Show the adjustment ✅
**Before** — an adjusted price appeared as a bare number, with no sign of how it got there.
**After** — the adjustment is shown signed, with the colour convention you asked for:
**green = customer pays more, red = discount.** Jargon removed from the column names,
numerals set in Calibri bold, and the item counts made clickable.
**Where to check** — same tab.

---

## §19 · Collaboration tracker

### K-19 · Ticket system with status flow + history ⬜ Open
This file is the interim tracker. A built-in module is a larger piece of work — worth
deciding first whether it belongs inside the software or stays a shared document.

---

## What to do after the restart

1. `npm run db:deploy` — applies the two additive migrations.
2. `restart.bat`.
3. Spot-check the five with the clearest before / after:
   - **Transporters** → click KERALA ROADWAYS' customer count. It should read **0**, not 1.
   - **Challans** → item-wise search → `5.5 RAMPATRA` → filter down to one party.
   - **CRM → Payment Recovery Desk** → Collect → tick two invoices, check the B / C totals.
   - **Save a follow-up** → confirm nothing nudges you for an hour. This is K-12.1's likely cause.
   - **Settings → General** → set quiet hours and confirm the badge appears.
   - **Roles & Permissions → Operator → Save**, then have an Operator open the app —
     they should land on Dispatch Order, not the Dashboard.
4. Mark anything you are happy with as 🟢 Verified, and send me the three answers above.
