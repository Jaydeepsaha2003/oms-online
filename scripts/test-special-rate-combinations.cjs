// Self-check for combination-aware design special rates (packages/shared
// special-rate.ts → pickDesign). No database, no server.
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.join(__dirname, '../apps/api/tsconfig.json'), transpileOnly: true });
const { resolveSpecialRates } = require('../packages/shared/src/types/special-rate.ts');

const CAT = 'GLASS';
const SUB = '7.5-SIZE-FG-22G-VIVO';
let id = 0;
const rule = (scope, target, rate, sub = SUB) => ({ id: ++id, kind: 'DESIGN', scope, category: CAT, subCategory: sub, target, rate });
const delta = (rates, designType) =>
  resolveSpecialRates({ rates, logos: [] }, { category: CAT, subCategory: SUB, product: 'VIVO', designType }).designDelta;

// The reported case: a member's rate carries into the combination.
assert.equal(delta([rule('ITEM', 'DIAMOND HAMMER', -30)], 'DIAMOND HAMMER+LOGO'), -30);
assert.equal(delta([rule('ITEM', 'DIAMOND HAMMER', -30)], 'DIAMOND HAMMER'), -30);

// Several members with their own rates add up, like their base rates do.
assert.equal(delta([rule('ITEM', 'DL', -5), rule('ITEM', 'HAMMER', -10)], 'HAMMER+DL+LOGO'), -15);

// A rule on the WHOLE combination name wins over its members.
assert.equal(delta([rule('ITEM', 'HANDLE+DL', 30), rule('ITEM', 'HANDLE', 30)], 'HANDLE+DL'), 30);

// Sub-category rules still apply ONCE per line, never multiplied by members.
assert.equal(delta([rule('SUBCATEGORY', null, -10)], 'DIAMOND HAMMER+LOGO'), -10);

// A member rule for a DIFFERENT sub-category does not leak in.
assert.equal(delta([rule('ITEM', 'DIAMOND HAMMER', -30, '7-SIZE-FG-22G-VIVO')], 'DIAMOND HAMMER+LOGO'), 0);

// No rules → no change.
assert.equal(delta([], 'DIAMOND HAMMER+LOGO'), 0);

console.log('special-rate combinations: all checks passed');
