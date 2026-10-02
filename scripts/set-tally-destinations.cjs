/**
 * "Final destination" on a Tally bill, as the accountant types it - one place per party (CHENNAI, VASAI, MANGOLPURI/DELHI).
 * OMS used to write "CITY,STATE" from its own customer city (BAJAJ: DELHI,DELHI instead of MANGOLPURI/DELHI).
 *
 * This reads every Sales bill of the FY from Tally (read-only), takes the destination the accountant himself used most for each party
 * - bills BEFORE OMS started posting (SSS-740) - and stores it in app_config TALLY_DESTINATIONS (party ledger name -> destination).
 * tally-posting.service.ts then uses it; a party with no hand-made bill falls back to the OMS city alone.
 *
 *   node scripts/set-tally-destinations.cjs           dry run: shows what would be stored, writes nothing
 *   node scripts/set-tally-destinations.cjs --apply   stores it (one row; re-run any time to refresh)
 */
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../apps/api/.env') });
const { PrismaClient } = require('@prisma/client');

const OMS_FROM = 740; // first bill OMS posted (SSS-740/26-27, 2026-09-23); everything before was typed by hand
const KEY = 'TALLY_DESTINATIONS';
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const tag = (v, t) => dec((v.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`)) ?? [, ''])[1]).replace(/\s+/g, ' ').trim();
const num = (s) => +(s.match(/SSS-0*(\d+)/)?.[1] ?? 0);

(async () => {
  const prisma = new PrismaClient();
  try {
    const cfg = JSON.parse((await prisma.appConfig.findUnique({ where: { key: 'TALLY_CONFIG' } })).value);
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    // Same read OMS itself does (OmsSales), plus the destination field.
    const xml =
      '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OmsDest</ID></HEADER><BODY><DESC>' +
      '<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>S.S.STEEL</SVCURRENTCOMPANY>' +
      `<SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">${today}</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>` +
      '<COLLECTION NAME="OmsDest"><TYPE>Voucher</TYPE><FETCH>VoucherNumber,Date,PartyLedgerName,IsCancelled,BasicFinalDestination</FETCH><FILTER>OmsIsSale</FILTER></COLLECTION>' +
      '<SYSTEM TYPE="Formulae" NAME="OmsIsSale">$VoucherTypeName = "Sales"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>';
    const res = await fetch(cfg.url, { method: 'POST', body: xml, signal: AbortSignal.timeout(60_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = (buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')).replace(/&#4;/g, '');
    const bills = [...text.matchAll(/<VOUCHER [^>]*>([^]*?)<\/VOUCHER>/g)]
      .map(([, v]) => ({ no: tag(v, 'VOUCHERNUMBER'), date: tag(v, 'DATE'), party: tag(v, 'PARTYLEDGERNAME'), dest: tag(v, 'BASICFINALDESTINATION'), cancelled: tag(v, 'ISCANCELLED') === 'Yes' }))
      .filter((b) => !b.cancelled && b.party && b.dest)
      .map((b) => ({ ...b, n: num(b.no) }));
    if (bills.length < 100) throw new Error(`Only ${bills.length} bills came back from Tally - not touching anything.`);

    const stored = new Map();
    for (const party of new Set(bills.map((b) => b.party))) {
      const hand = bills.filter((b) => b.party === party && b.n < OMS_FROM).sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
      if (!hand.length) continue;
      const count = new Map();
      for (const b of hand) count.set(b.dest, (count.get(b.dest) ?? 0) + 1);
      // most used; on a tie the later bill wins
      const best = [...count.entries()].sort((a, b) => b[1] - a[1] || hand.findLast((x) => x.dest === b[0]).n - hand.findLast((x) => x.dest === a[0]).n)[0][0];
      stored.set(party.trim().toUpperCase(), best);
    }

    const fix = [];
    for (const party of new Set(bills.map((b) => b.party))) {
      const omsBills = bills.filter((b) => b.party === party && b.n >= OMS_FROM);
      const want = stored.get(party.trim().toUpperCase());
      const wrong = omsBills.filter((b) => want && b.dest !== want);
      if (wrong.length) fix.push({ party, want, wrote: [...new Set(wrong.map((b) => b.dest))].join(' | '), bills: wrong.map((b) => b.no.replace('/26-27', '')).join(' ') });
    }
    console.log(`Tally bills read: ${bills.length}. Parties with a hand-made bill (destination known): ${stored.size}.`);
    console.log(`Parties where OMS already wrote a different destination: ${fix.length}\n`);
    for (const f of fix) console.log(`${f.party}\n   OMS wrote: ${f.wrote}   [${f.bills}]\n   from now : ${f.want}`);

    const row = JSON.stringify(Object.fromEntries([...stored.entries()].sort()));
    if (process.argv.includes('--apply')) {
      await prisma.appConfig.upsert({ where: { key: KEY }, update: { value: row }, create: { key: KEY, value: row } });
      console.log(`\nSTORED ${stored.size} destinations in app_config ${KEY}.`);
    } else console.log(`\nDRY RUN - nothing stored (${stored.size} destinations ready). Add --apply to store them.`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
