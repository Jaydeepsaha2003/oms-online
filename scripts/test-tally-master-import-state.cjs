const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

const party = (how, customerId = 22) => ({
  tallyName: 'B K METAL',
  tallyGroup: 'Sundry Debtors',
  match: how ? { customerId, how } : null,
  suggestions: [],
  linkedTo: null,
  tallyOpening: null,
  tallyClosing: null,
  inList: false,
});

(async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'apps/web/src/features/customers/tally-master-import-state.ts')).href;
  const { initialTallyPartyCustomerId, tallyPartyReviewBucket } = await import(moduleUrl);

  assert.equal(initialTallyPartyCustomerId(party('LINKED')), 22, 'a saved alias is selected again');
  assert.equal(initialTallyPartyCustomerId(party('SAME_NAME')), 22, 'the same OMS name is selected again');
  assert.equal(initialTallyPartyCustomerId(party('LOOKS_LIKE')), null, 'a guess is not presented as a saved selection');
  assert.equal(initialTallyPartyCustomerId(party(null)), null, 'an unmatched ledger remains unselected');
  assert.equal(tallyPartyReviewBucket({ customerId: 22, previouslySkipped: true }), 'matched', 'a mapped party is no longer skipped');
  assert.equal(tallyPartyReviewBucket({ customerId: null, previouslySkipped: true }), 'skipped', 'an earlier unmapped party stays separate');
  assert.equal(tallyPartyReviewBucket({ customerId: null, previouslySkipped: false }), 'missing', 'only a first-time unmapped party is new');

  console.log('PASS Tally master guesses require an explicit party selection');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
