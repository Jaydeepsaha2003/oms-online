// The past-sale picker on a Debit/Credit Note must not offer sales that had not
// happened yet when the note is dated. Reads the rule straight out of the page
// source so it cannot pass against a copy that has drifted from what ships.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = path.resolve(__dirname, '../apps/web/src/features/account/notes-page.tsx');
const src = fs.readFileSync(page, 'utf8');

// The filter itself, and that every consumer reads the filtered list.
assert.match(src, /ymd\(new Date\(r\.invDate\)\) <= invDate/, 'the picker must be cut off at the note date');
// The unfiltered list may only be fetched, filtered, and counted for the empty
// message. Anything that picks, adds or indexes a sale must read the filtered one.
const ALLOWED_RAW_USES = [
  /^soldHistory = \[\] \} = useRecentSold\(/, // fetched
  /^soldHistory\.filter\(/, //                   filtered into recentSold
  /^soldHistory, invDate\],/, //                 that filter's dependency
  /^soldHistory\.length && !recentSold\.length/, // "why is this list empty?"
];
for (const use of src.match(/\bsoldHistory\b[^\r\n]*/g) ?? []) {
  assert.ok(
    ALLOWED_RAW_USES.some((re) => re.test(use.trim())),
    `only the date-filtered list may pick, add or index a past sale — found: ${use.trim()}`,
  );
}
assert.equal((src.match(/\bsoldHistory\b/g) ?? []).length, ALLOWED_RAW_USES.length);
// The option's value is its position, so the list rendered and the list indexed
// into must be one and the same array.
assert.match(src, /options=\{recentSold\.map/, 'the dropdown must render the filtered list');
assert.match(src, /const r = recentSold\[i\]/, 'picking must index the filtered list');

// The rule itself, exercised on dates rather than trusted from the source.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offered = (rows, noteDate) => rows.filter((r) => ymd(new Date(r.invDate)) <= noteDate);

// Local midnight, the way a challan date is entered — NOT UTC. Slicing the ISO
// string here would read 19 July for a sale made on the 20th in India.
const local = (y, m, d) => new Date(y, m - 1, d).toISOString();
const sales = [
  { invNo: 'SSS/26-27/664', invDate: local(2026, 6, 30) },
  { invNo: 'SSS/26-27/677', invDate: local(2026, 7, 20) }, // the note's own day: included
  { invNo: 'SSS/26-27/682', invDate: local(2026, 7, 21) }, // the day after: excluded
  { invNo: 'SSS/26-27/701', invDate: local(2026, 9, 2) },
];

const on20 = offered(sales, '2026-07-20').map((r) => r.invNo);
assert.deepEqual(on20, ['SSS/26-27/664', 'SSS/26-27/677'], 'a sale dated after the note must not be offered');
assert.deepEqual(offered(sales, '2026-07-19').map((r) => r.invNo), ['SSS/26-27/664']);
assert.equal(offered(sales, '2026-09-12').length, 4, 'a note dated today still sees everything');
assert.equal(offered(sales, '2026-01-01').length, 0, 'nothing yet sold is nothing to offer');

// Moving the note's date moves the cut-off with it, in both directions.
assert.equal(offered(sales, '2026-07-21').length, 3);
assert.equal(offered(sales, '2026-06-30').length, 1);

console.log('PASS: past-sale picker stops at the note date, on the local calendar day');
