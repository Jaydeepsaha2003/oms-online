// Request cheque photo from phone: the ask pushes to the system admin with a link
// to /cheque-photo/:id; the phone's photo lands on the request the form polls.
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.join(__dirname, '../apps/api/tsconfig.json'), transpileOnly: true });
const { ChequePhotoRequestsService } = require('../apps/api/src/cheques/cheque-photo-requests.service.ts');
const sent = [];
let asked = null;
const svc = new ChequePhotoRequestsService(
  { userIdsWith: async (p) => { asked = p; return ['admin']; } },
  { notifyUsers: (ids, n) => sent.push({ via: 'app', ids, n }) },
  { sendToUsers: async (ids, n) => sent.push({ via: 'push', ids, n }) },
);
(async () => {
  try {
    const r = await svc.create({ partyName: 'ANANDA HOME NEEDS', chequeAmt: 20000 }, 'SAHIL');
    assert.equal(asked, '*');
    assert.deepEqual(sent.map((s) => s.via), ['app', 'push']);
    assert.deepEqual(sent[1].ids, ['admin']);
    assert.equal(sent[1].n.data.url, `/cheque-photo/${r.id}`);
    assert.match(sent[1].n.body, /ANANDA HOME NEEDS · ₹20,000 · asked by SAHIL/);
    console.log('PASS the ask reaches the system admin with a link to the photo page');
    assert.equal(svc.get(r.id).photoUrl, null);
    svc.complete(r.id, '/api/uploads/cheques/a.jpg');
    assert.equal(svc.get(r.id).photoUrl, '/api/uploads/cheques/a.jpg');
    assert.throws(() => svc.get('nope'), /expired/);
    console.log('PASS the phone photo lands on the request the form is polling; unknown ids are refused');
  } catch (e) {
    console.error(`FAIL ${e.stack ?? e.message}`);
    process.exitCode = 1;
  }
})();