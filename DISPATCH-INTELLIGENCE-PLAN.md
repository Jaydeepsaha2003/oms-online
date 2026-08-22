# Dispatch Intelligence — data findings and engine plan

Plan only. Nothing in the existing Dispatch Form changes as a result of this
document; the new engine ships behind an OFF-by-default toggle and the current
screen keeps working exactly as it does today.

Companion to `OMS_Dispatch_Detailed_Specification.md` (the owner's business
requirement). Where this document disagrees with that one, the spec wins — but
§27 of the spec requires the ambiguities to be asked rather than assumed, and
[Part 3](#part-3--questions-that-must-be-answered-before-coding) is that list.

Evidence base: `oms-backup-2026-08-08-1308.db` — **4,029 dispatch rows**, 1,943
challans, 3,534 order lines, 144 parties. Every figure below is measured, not
estimated.

---

## Part 1 — What the history actually says

### 1.1 Units really are category-specific (confirms spec §2–§3)

Share of dispatch rows where each unit was filled in:

| Category | rows | bags | pcs | kg | box | primary |
|---|---|---|---|---|---|---|
| GLASS | 3,394 | 95% | 7% | **100%** | 0% | kg |
| CUP | 626 | 54% | **100%** | 100% | 84% | pcs |
| GLASS (PCS) | 4 | 100% | 100% | 75% | — | — |
| LOTI | 3 | 100% | 100% | 100% | — | — |
| TUMBLER | 2 | 100% | 0% | 100% | — | — |

GLASS is kg-primary with bags as packing, exactly as §4 says. CUP is
pcs-primary — but **kg is also filled on 100% of CUP rows**, so a CUP rule that
ignores kg would be discarding data the operators do enter.

Three categories have fewer than five rows in the whole book. They need a
configuration default, not their own tuned thresholds.

### 1.2 The "1 bag = 70 kg" rule holds — but only for whole bags

kg per bag, GLASS, 3,221 rows where both bags and kg were entered:

| | p1 | p5 | p25 | median | p75 | p95 | p99 | max | under 65 | over 80 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Whole bags** (2,131 · 66%) | 43.2 | 61.9 | 68.9 | **71.6** | 75.3 | 80.9 | 83.6 | 96.7 | **9.9%** | 9.3% |
| **Fractional bags** (1,090 · 34%) | 13.9 | 28.0 | 57.8 | 73.6 | 88.0 | 122.5 | 148.8 | 186.4 | **35.1%** | 37.9% |

Exactly-1-bag rows (n=1,703) are tighter still: median **71.6**, p95 80.8,
p99 84.0.

**This is the single most important finding.** The per-bag kg threshold is a
sound rule for whole bags and close to meaningless for fractional ones — which
is precisely what spec §5.5 warns ("should not be blindly applied to mixed-item
packing") and §6.8 restates. Any engine that applies one kg/bag band to both
will misjudge a third of all dispatch rows.

**A third of the book is mixed packing.** Not an edge case — the normal way this
business ships. The fractional values in use:

| bags | rows | | bags | rows |
|---|---|---|---|---|
| 0.5 | 747 | | 0.2 | 20 |
| 0.33 | 129 | | 1.5 | 19 |
| 0.25 | 90 | | 2.5 | 7 |
| 0.34 | 65 | | 0.75 | 4 |

0.33 **and** 0.34 both appear — operators split a bag three ways and round by
hand. An engine that requires bag shares to sum to exactly 1.00 will reject
real, correct dispatches.

### 1.3 A kg threshold alone cannot decide Full vs Partial

Testing "≥65 kg per bag ⇒ Full" against the status actually recorded on 2,131
whole-bag GLASS rows:

| | rows |
|---|---|
| recorded FULL, rule agrees | 1,238 |
| recorded FULL, rule says Partial | 148 |
| **recorded PARTIAL, rule says Full** | **682** |
| recorded PARTIAL, rule agrees | 63 |

**61.1% agreement.** The rule is not close to sufficient on its own, and the
682-row bucket says why: a row can be a perfectly good 70 kg bag *and still have
pending quantity left*. Meeting the threshold does not close a row — clearing
its balance does.

So the threshold is not a Full test. It is a **tolerance** that lets a dispatch
count as clearing its balance despite physical variance: pending 70 kg,
dispatched 66, and the row closes because 66 ≥ 70 − tolerance. Read as an
absolute floor it produces 682 wrong Full calls in this book alone.

This needs the owner's confirmation — see [Q1](#q1--is-the-threshold-a-floor-or-a-tolerance).

### 1.4 Cumulative dispatch is real but not the common case

| transactions on one order line | lines | share |
|---|---|---|
| 1 | 2,325 | 80.4% |
| 2 | 336 | 11.6% |
| 3 | 116 | 4.0% |
| 4+ | 94 | 3.3% |

**19.6%** of lines ship in more than one transaction; the worst runs to **14**.
So §8/§9 matter, but the engine must not make the 80% case pay for the 20%.

### 1.5 The error patterns the spec fears

**Reversed entries (§11): none.** Two rows in 4,029 have bags > kg, and neither
is a swap — both are **pcs-primary rows with kg deliberately left blank**:

| dispatch | party | category | bags | kg | pcs | box |
|---|---|---|---|---|---|---|
| DSP-04203 | SHRI NARSINGH ENTERPRISES | GLASS (PCS) | 1.0 | 0 | 529 | 0 |
| DSP-04122 | RANJITHAM METAL STORES | CUP | 0.33 | 0 | 56 | 14 |

So the `bags=66, kg=1` scenario has never happened. Worth keeping as a cheap
guard, but it is prophylactic — not a live problem, and not worth a hard block.

Two related facts fall out: those same two rows are the **only** rows in the book
with bags but no kg, so in GLASS kg is effectively mandatory alongside bags; and
a naive `bags > kg` test would flag both of them as errors when they are correct.
The reversed-entry check must therefore compare against the category's *primary*
unit, not against kg unconditionally.

**Impossible bag/kg combinations (§10): 69 rows (2.1%) exceed 120 kg/bag** — and
**every one is a fractional-bag row**:

| dispatch | party | bags | kg | kg/bag |
|---|---|---|---|---|
| DSP-02182 | METRO METALS | 0.25 | 46.6 | 186 |
| DSP-01348 | VASANTHA MAALIGAI | 0.25 | 45.4 | 181 |
| DSP-03202 | MANGAL & MANGAL | 0.25 | 41.7 | 167 |

A naive "0.5 bag cannot hold 120 kg" block would fire on all 69. Either the bag
*share* was understated (46.6 kg of a ~71 kg bag is ~0.65, not 0.25) or the share
means something other than a capacity fraction. Until that is settled, this
cannot be a hard block — see [Q2](#q2--what-does-a-fractional-bag-number-mean).

### 1.6 Party behaviour is genuinely separable (supports §22–§23)

Share of each party's GLASS rows that used fractional bags:

| party | rows | whole | mixed |
|---|---|---|---|
| PNB | 245 | 88% | 12% |
| CHAITANYA STAINLESS STEEL | 168 | 88% | 12% |
| SHRI NARSINGH ENTERPRISES | 77 | 88% | 12% |
| METRO METALS | 289 | 47% | 53% |
| MANGAL & MANGAL | 224 | 44% | 56% |
| RAKESH MARKETING | 83 | 29% | **71%** |

Real, stable, per-party signal — enough for the optional suggestion layer of
§20–§25, and enough that "this party normally takes whole bags" is a statement
with evidence behind it rather than a guess.

### 1.7 CUP's own relationships

pcs per box: median **6**, observed set {2, 4, 5, 6, 14}. kg per box ~0.6.
Discrete pack sizes, almost certainly per-product (the product master carries a
`pcs` field). CUP needs a pcs↔box rule sourced from the product master, not a
tuned band like GLASS's.

---

## Part 2 — Engine plan

### 2.1 Shape

A **pure decision function** in `@oms/shared`, with no database, network or React
in it:

```
evaluateDispatch(input: DispatchEvaluationInput): DispatchEvaluation
```

Pure because it is the only way to get what §14.5 asks for — one engine behind
new dispatch, Modify Dispatch and Pending Challan — and the only way to test it
against the 4,029 historical rows above without standing up a server. Every
number it needs (pending balances, cumulative history, category config) arrives
in the input; it reads nothing for itself.

This mirrors `resolveCommissionRate`, which is already shared between the
commission pricing engine and its UI tester precisely so the two cannot drift.

### 2.2 Layers, in the order §28 sets out

| # | Layer | Answers |
|---|---|---|
| 1 | Category rule resolver | which units apply, which is primary, what the bag relationship is |
| 2 | Unit validation | are the filled units ones this category uses? |
| 3 | Row relationship checks | bag↔kg, pcs↔box consistency, reversed-entry suspicion |
| 4 | Row balance | does this dispatch clear the row's pending, within tolerance? |
| 5 | Batch / mixed packing | do the bag shares across rows form a coherent physical bag? |
| 6 | Cumulative history | has the requirement been completed across transactions? |
| 7 | Decision | per-row Full/Partial + overall, each with a reason string |

Layers 1–4 are per row; 5–7 need the whole batch. One call takes the batch and
returns both levels, because §12.2 requires a batch verdict and §7 requires the
row verdicts to survive it.

### 2.3 Configuration, not constants

Per category, stored and editable — never hard-coded (§3.1, §4.7):

| setting | GLASS (from the data) | CUP |
|---|---|---|
| applicable units | bags, kg | pcs, box, kg, bags |
| primary unit | kg | pcs |
| nominal per bag | 71.6 (median) | — |
| tolerance band | to be set — see Q1 | — |
| hard-block ceiling | ≥ 96.7 observed max, whole bags only | — |
| pcs per box | — | from product master |

The GLASS defaults above are what the history supports; the owner sets the final
values. The seeded defaults should come from these percentiles rather than from
round numbers, so the engine starts calibrated to this business.

### 2.4 The toggle

- A single setting, **default OFF**, in Settings → Dispatch.
- OFF: the current form behaves exactly as today. The engine is not called.
- ON: the engine runs and shows its verdict and reasons; validation is
  **advisory only** in the first release — it never blocks a submit.
- A third state worth having: **Shadow**, where the engine runs and records its
  verdict without showing anything. That is how to find out whether it agrees
  with the operators on live traffic before anyone relies on it — the 61%
  agreement in §1.3 is exactly the kind of thing shadow mode exists to catch.

### 2.5 Phasing

1. **Engine + tests.** The pure function and its config, replayed against all
   4,029 historical rows. Deliverable: an agreement report per category. No UI.
2. **Shadow mode.** Toggle exists, engine runs, verdicts recorded, nothing shown.
3. **Advisory UI.** Row and batch verdicts with reasons; soft warnings only.
4. **Blocking + override.** Only once the agreement rate justifies it, with the
   Super Admin override and audit trail of §17.
5. **Suggestion layer.** Party/category patterns from §1.6, strictly advisory,
   never overriding the rule engine (§25).

Each phase is independently shippable and independently reversible.

### 2.6 Explicitly out of scope

- No change to the existing Dispatch Form's behaviour, layout or validation.
- No change to how pending quantities are computed (§13.3).
- No rebuild of the order-balance system.
- No ML in phases 1–4 (§20.1).

---

## Part 3 — Questions that must be answered before coding

Spec §27 requires these to be asked. Each one changes the engine's output, and
each is drawn from a disagreement between the spec and the data.

### Q1 — Is the threshold a floor or a tolerance?

"Minimum 65 kg" reads as an absolute floor. Applied as one, it calls **682
historical rows Full that were recorded Partial** (§1.3).

As a *tolerance* — a row closes when `dispatched ≥ pending − tolerance` — those
682 stay Partial, because their pending exceeded one bag.

**Which is intended?** And if tolerance: is it per bag (5 kg), a percentage
(~7%), or per category in absolute kg?

### Q2 — What does a fractional bag number mean?

DSP-02182: **0.25 bag, 46.6 kg**. If a bag is ~71 kg, 46.6 kg is about 0.65 of
one. Three readings:

1. the operator's estimate of the share, loosely kept — then no bag/kg block is
   possible on fractional rows;
2. a count of physical bags touched, not a capacity fraction;
3. a data-entry error that should have been caught.

69 rows (2.1%) look like this. **Which is it?** Without an answer §10's hard
block cannot be built safely.

### Q3 — Must bag shares in a mixed dispatch sum to a whole bag?

§6.5 says four rows at 0.25 make "1 Bag". But 0.33 **and** 0.34 both appear in
the data, so real shares do not sum cleanly. Is "shares should total ≈ a whole
number" a check at all — and if so, warning or block, and with what tolerance?

### Q4 — For CUP, which unit decides Full?

pcs is filled on 100% of CUP rows, box on 84%, **kg on 100%**. §2.4 says Cups are
pieces-primary. Does the kg on every CUP row matter to the decision, or is it
recorded for weight/freight only and ignored by the engine?

### Q5 — Whose status is `dispatchStatus` today?

The column holds `FULLY DISPATCH` / `PARTIALLY DISPATCH` per dispatch row
(2,829 / 1,200). Does the engine's verdict **replace** this, sit **beside** it as
a second opinion, or only surface at Pending Challan as §14.1 suggests?

### Q6 — Categories with almost no history

GLASS (PCS), LOTI, TUMBLER have 4, 3 and 2 rows. Should they inherit a global
default, inherit from GLASS, or be excluded from the engine until configured —
and, when unconfigured, should the engine stay silent rather than guess?

### Q7 — What does the toggle scope to?

Global, per user, or per role? Should the operator be able to see whether it is
on, and can a Super Admin turn it on for themselves alone while the floor keeps
the old behaviour?

---

---

## Part 4 — Customizable settings: category and party

The engine has no opinions of its own. Every number it uses is a setting, and
this part is the model for those settings and the evidence behind its shape.

### 4.1 Two findings that decide the shape

**Finding A — most parties should not be tuned at all.** For GLASS whole bags,
party medians span 69.5 … 76.5 kg/bag: a **7.0 kg** spread between parties. But
the spread *within* a single party (p10–p90) has a median of **13.5 kg** —
nearly double. The variation is mostly inside each party, not between them, so a
party-level value is fitting noise for most of them.

Applying the honest test — *at least 30 rows of history, and the party's own
p25–p75 does not contain the category value* — **4 of 19** well-sampled parties
earn an override:

| party | rows | p25 | median | p75 | vs category 71.6 |
|---|---|---|---|---|---|
| RANJITHAM METAL STORES | 74 | 73.4 | **76.5** | 78.9 | entirely above |
| VIJAY VALLABH METALS | 37 | 71.7 | **76.2** | 80.3 | entirely above |
| WINCHEF INTERNATIONAL | 40 | 71.7 | **73.9** | 78.6 | entirely above |
| PNB NE | 62 | 66.6 | **69.5** | 71.6 | entirely below |

The other 15 straddle the category value and should inherit it. And **67 parties
have fewer than 30 rows** — never enough to tune, so they must inherit by design,
not by omission.

So party settings are **sparse exceptions**, and nobody should be asked to fill
in 144 of them.

**Finding B — a party-level value must be scoped to a category.** The same party
behaves differently per category:

| party | GLASS kg/bag | CUP kg/bag |
|---|---|---|
| RANJITHAM METAL STORES | 76.5 (n=74) | **59.4** (n=17) |
| METRO METALS | 73.5 (n=137) | **59.4** (n=16) |
| SANCHETI STEEL HOUSE | 70.0 (n=39) | **9.1** (n=10) |

A party-only override would push RANJITHAM's 76.5 onto its CUP rows where
reality is 59.4, and SANCHETI's 70.0 onto rows that really run at 9.1. So the
override level is **party + category**, and a party-only level is deliberately
*not* offered.

This is the same trap, and the same fix, as the Special Commission cascade: a
party-wide commission rate leaking across categories priced in different units.
The guard there was to require the unit to match; the guard here is to require
the category to be named.

### 4.2 Resolution order

```
party + category   →   category   →   global default
```

Most specific wins, first hit stops the search, and each setting resolves
independently — a party may override the tolerance while inheriting everything
else. Deliberately only three levels: every extra level multiplies the ways a
number can arrive without anybody being able to say which rule produced it.

The engine must return, with every verdict, **which level supplied each value it
used**. Without that, "why did this row come out Partial?" is unanswerable, and
§18 requires it to be answerable.

### 4.3 The settings

| setting | unit | GLASS (from history) | CUP | notes |
|---|---|---|---|---|
| `applicableUnits` | — | bags, kg | pcs, box, kg, bags | drives which fields the engine reads at all |
| `primaryUnit` | — | kg | pcs | the unit Full/Partial is decided in |
| `nominalPerBag` | kg | **71.6** (median) | — | the working "1 bag =" figure |
| `closeTolerance` | kg or % | see Q1 | — | how short a dispatch may fall and still close the row |
| `bagCeiling` | kg/bag | ≥ **96.7** (observed max, whole bags) | — | hard-block line, **whole bags only** |
| `pcsPerBox` | pcs | — | from product master | observed set {2, 4, 5, 6, 14} |
| `mixedSumTolerance` | bags | see Q3 | — | 0.33+0.34+0.33 must be allowed |
| `packingHabit` | — | — | — | whole / mixed / either — advisory only |
| `severity` per rule | — | warn / block / off | | so a rule can be softened without code |

Every value is editable; none is compiled in. The GLASS column is what this
book's history supports — seeded as a **starting point**, not a decision.

`severity` being a setting is what makes the rollout safe: every check can ship
as `warn`, and be promoted to `block` one at a time once its false-positive rate
is known. It is also the answer to §16 — normal/soft/hard is per rule, per
category, and therefore tunable without a release.

### 4.4 Seeding, and "propose from history"

The screen should not open empty. Two mechanisms:

1. **Seed on install** from the percentiles in Part 1, per category found in the
   book. A category with fewer than ~20 rows (GLASS (PCS), LOTI, TUMBLER — 4, 3
   and 2 rows) gets the global default and is marked *unconfigured*, because
   three rows cannot support a threshold.

2. **Propose overrides**, using the test in 4.1: for each party + category with
   at least 30 rows whose p25–p75 excludes the inherited value, offer the party's
   own median with its evidence — row count, quartiles, and the value it would
   replace. The owner accepts or dismisses each one; nothing is applied silently.

That second mechanism is the "intelligence" in a settings screen: on this book it
surfaces exactly **4** suggestions out of 144 parties, which is a list somebody
will actually read. A screen that instead showed 144 editable rows would get one
value typed into it and be abandoned.

Dismissals must be remembered, or the same four suggestions reappear forever.

### 4.5 Where it lives

One table, `dispatch_rule_settings`, with nullable `customerId` and `pCategory`
and an explicit `scope` column (`GLOBAL` | `CATEGORY` | `PARTY_CATEGORY`) — the
same shape as `agent_special_commissions`, for the same reason: the scope must be
recorded rather than inferred from which columns happen to be null, or clearing
a field silently widens a rule instead of breaking it.

Each row carries `updatedBy`, `updatedAt` and an optional `note` (why this party
is different). No effective dating in v1: the engine decides at entry time and
never re-evaluates a past dispatch, so a threshold change has nothing to rewrite.
Add dating only if the owner wants historical replay to use period-correct rules
— a real requirement for an audit, and a needless complication if not.

### 4.6 The screen

**Settings → Dispatch Intelligence**, three tabs:

- **Categories** — one row per category found in the book, its settings inline,
  *unconfigured* marked plainly. This is where 95% of the work is done.
- **Party overrides** — the sparse list of what has been overridden, plus the
  **Suggested** panel from 4.4 with its evidence. Empty is the correct and normal
  state.
- **Rule severity** — every check with its warn/block/off setting, so the
  rollout in 2.5 can be steered without a deploy.

Plus a **rule tester**: pick a party, a category and a dispatch quantity, and see
the verdict with the setting level that supplied each number. Same reasoning as
the Special Commission tester — one that re-implements the rules eventually
disagrees with the engine, so it must call the engine.

### 4.7 Guardrails

1. A party override may **tighten** but never **loosen** a hard block below the
   global ceiling — a per-party escape hatch from a safety rule is how safety
   rules stop meaning anything. Loosening stays a Super Admin override (§17), on
   the individual dispatch, with its audit trail.
2. Changing a setting **never** re-evaluates a past dispatch.
3. A setting that would flag more than a stated share of that category's history
   (say 5%) is shown with that number before it can be saved. The 65 kg floor
   would have read *"this would flag 18.4% of GLASS history"* — the fastest way
   to learn a threshold is wrong.
4. Deleting a category setting reverts to global, and says so.

### 4.8 Two more questions

#### Q8 — who may edit these settings?

Category thresholds change what the whole floor sees. Super Admin only, or any
user with a dispatch-settings permission? And should party overrides be editable
by whoever manages the party, or held to the same bar as category defaults?

#### Q9 — should the engine ever propose a setting change on its own?

If a party's recent dispatches drift away from its configured value, should the
system say so — *"RANJITHAM has averaged 79 kg/bag over the last 40 dispatches
against a configured 76.5"* — or stay silent until somebody asks? §26 wants a
quiet system; a drift notice is useful exactly once and irritating thereafter.

---

## Appendix — how to reproduce

Every figure came from read-only queries against
`oms-backup-2026-08-08-1308.db`. The live `dev.db` was never opened. Queries are
plain SQL over `dispatches` joined to nothing — deliberately, so the numbers can
be re-checked against any future backup with the same script.
