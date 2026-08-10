/**
 * One-time repair: make legacy receipts editable/deletable — but ONLY the ones
 * whose reversal set can be proven complete.
 *
 * Receipts saved before edit support carry none of what reverse-and-replay
 * needs: `AcctLedger.adjMode` is null (so `editabilityFor` locks them) and
 * `sourceVoucherNo` — the column every reversal deletes by — is null on all of
 * their child rows. Enabling edit/delete without repairing that would drop the
 * voucher header and leave its allocations behind, so invoices would stay
 * wrongly settled and advances would become phantom balances.
 *
 * The data does still link children to their voucher, via `refRecId`:
 *   - receipt-funded allocations  → refRecId = the voucher no
 *   - advance-funded allocations  → refRecId = the ADVANCE's refId, so these are
 *     attributed through the REC- `refId` group they share with the voucher's
 *     receipt-funded rows
 *   - advances / opening clearances → refRecId = the voucher no
 *
 * That covers most rows but not all, and an un-attributed row is invisible: we
 * cannot tell which voucher it belonged to. So rather than trusting the linkage
 * blindly, each voucher must PROVE its set is complete by reconciling:
 *
 *     receipt amount  ==  opening clearances
 *                       + allocations funded by this receipt (modeOfAdj != ADVANCE)
 *                       + the advance this receipt spilled into
 *
 * (Advance-funded allocations are deliberately NOT in that sum — they spend an
 * older advance, not today's cash.) A voucher that reconciles to the paisa has
 * had every money-moving child found, so reversing it is exact. A voucher that
 * does not is left exactly as it is — still locked, still honest about why.
 *
 * Idempotent: re-running only ever re-writes the same values.
 *
 *   npx tsx scripts/backfill-receipt-edit-support.ts          # report only
 *   npx tsx scripts/backfill-receipt-edit-support.ts --apply  # write
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 0.02; // paisa-level tolerance across summed floats

async function main() {
  const receipts = await prisma.acctLedger.findMany({
    where: { voucherType: 'RECEIPT' },
    orderBy: { id: 'asc' },
  });

  // Pull every candidate child set once — far cheaper than per-voucher queries.
  const allocs = await prisma.acctPaymentReceipt.findMany();
  const advances = await prisma.acctPartyAdvance.findMany();
  const clearances = await prisma.acctOpeningTrans.findMany({ where: { kind: 'CLEARANCE' } });

  const allocByVoucher = new Map<string, typeof allocs>();
  const allocByRefId = new Map<string, typeof allocs>();
  for (const a of allocs) {
    if (a.refRecId?.startsWith('RN/')) {
      const list = allocByVoucher.get(a.refRecId) ?? [];
      list.push(a);
      allocByVoucher.set(a.refRecId, list);
    }
    if (a.refId) {
      const list = allocByRefId.get(a.refId) ?? [];
      list.push(a);
      allocByRefId.set(a.refId, list);
    }
  }
  const advByVoucher = new Map<string, typeof advances>();
  for (const v of advances) {
    if (!v.refRecId) continue;
    const list = advByVoucher.get(v.refRecId) ?? [];
    list.push(v);
    advByVoucher.set(v.refRecId, list);
  }
  const clrByVoucher = new Map<string, typeof clearances>();
  for (const c of clearances) {
    if (!c.refRecId) continue;
    const list = clrByVoucher.get(c.refRecId) ?? [];
    list.push(c);
    clrByVoucher.set(c.refRecId, list);
  }

  /**
   * Parties poisoned by un-attributable advance-funded allocations.
   *
   * A few allocations spend an OLD advance but name only that advance, and share
   * their REC- group with nothing — so there is no way to tell which voucher
   * created them. They survive any reversal (nothing can delete what nothing
   * points at), which leaves the old advance still marked drawn. Replay then
   * can't reuse that advance, so the replayed receipts spill cash into NEW
   * advances instead and the party's books stop tying out — measured at 1,884
   * unaccounted on RANJITHAM METAL STORES in testing.
   *
   * The whole PARTY has to be excluded, not just the owning voucher: replay runs
   * over every later receipt for that party, so one poisoned row can throw off
   * any of them. These stay locked, exactly as they are today.
   */
  const poisonedParties = new Set<number>();
  {
    const advFunded = allocs.filter((a) => a.modeOfAdj === 'ADVANCE');
    for (const a of advFunded) {
      const attributable = a.refId ? (allocByRefId.get(a.refId) ?? []).some((s) => s.refRecId?.startsWith('RN/')) : false;
      if (!attributable) poisonedParties.add(a.custId);
    }
  }

  let enabled = 0;
  let skipped = 0;
  let alreadyOk = 0;
  let poisoned = 0;
  const skipDetail: string[] = [];

  for (const led of receipts) {
    if (led.adjMode != null) {
      alreadyOk++;
      continue;
    }
    if (poisonedParties.has(led.custId)) {
      poisoned++;
      continue;
    }
    const vno = led.voucherNo;
    const own = allocByVoucher.get(vno) ?? [];
    // The voucher's REC- id: shared by every allocation it created, including the
    // advance-funded ones that don't name the voucher themselves.
    const refId = own.find((a) => a.refId)?.refId ?? null;
    const group = refId ? (allocByRefId.get(refId) ?? []) : [];
    // Union: rows naming this voucher + rows sharing its REC- id.
    const childAllocs = [...new Map([...own, ...group].map((a) => [a.id, a])).values()];
    const adv = advByVoucher.get(vno) ?? [];
    const clr = clrByVoucher.get(vno) ?? [];

    const amount = r2(led.bankCredit || led.cashCredit);
    // Only receipt-funded allocations consume today's cash.
    const fundedByReceipt = r2(childAllocs.filter((a) => a.modeOfAdj !== 'ADVANCE').reduce((s, a) => s + a.recAmt, 0));
    const clearedOpening = r2(clr.reduce((s, c) => s + c.bankAmt + c.cashAmt, 0));
    const spilled = r2(adv.reduce((s, v) => s + v.bankAmt + v.cashAmt, 0));
    const accounted = r2(fundedByReceipt + clearedOpening + spilled);

    if (Math.abs(accounted - amount) > EPS) {
      skipped++;
      if (skipDetail.length < 12) {
        skipDetail.push(
          `${vno} ${led.customerName}: receipt ${amount} vs accounted ${accounted} ` +
            `(alloc ${fundedByReceipt} + opening ${clearedOpening} + advance ${spilled})`,
        );
      }
      continue;
    }

    // Reconciled — every money-moving child is identified, so this voucher can
    // be reversed exactly. Recover what replay needs.
    const nonAdvanceMode = childAllocs.find((a) => a.modeOfAdj && a.modeOfAdj !== 'ADVANCE')?.modeOfAdj;
    const adjMode = nonAdvanceMode ?? (childAllocs.length || spilled > 0 ? 'ADVANCE' : 'AUTOMATIC');
    const selectedInvNos =
      adjMode === 'AGST REF'
        ? JSON.stringify([...new Set(childAllocs.filter((a) => a.modeOfAdj !== 'ADVANCE').map((a) => a.invNo))])
        : null;
    // Mode-specific detail lives only on the children for legacy rows.
    const detailFrom = childAllocs.find((a) => a.bankName || a.cashTransLocation || a.cashRecBy || a.chequeNo) ?? adv[0];

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.acctLedger.update({
          where: { id: led.id },
          data: {
            adjMode,
            selectedInvNos,
            receiptRefId: led.receiptRefId ?? refId,
            advanceRefId: led.advanceRefId ?? adv[0]?.refId ?? null,
            takeAccOn: led.takeAccOn ?? (led.custId !== 0 ? 'PARTY' : 'AGENT'),
            bankName: led.bankName ?? detailFrom?.bankName ?? null,
            chequeNo: led.chequeNo ?? detailFrom?.chequeNo ?? null,
            cashTransLocation: led.cashTransLocation ?? detailFrom?.cashTransLocation ?? null,
            cashRecBy: led.cashRecBy ?? detailFrom?.cashRecBy ?? null,
          },
        });
        if (childAllocs.length) {
          await tx.acctPaymentReceipt.updateMany({
            where: { id: { in: childAllocs.map((a) => a.id) } },
            data: { sourceVoucherNo: vno },
          });
        }
        if (adv.length) {
          await tx.acctPartyAdvance.updateMany({ where: { id: { in: adv.map((v) => v.id) } }, data: { sourceVoucherNo: vno } });
        }
        if (clr.length) {
          await tx.acctOpeningTrans.updateMany({ where: { id: { in: clr.map((c) => c.id) } }, data: { sourceVoucherNo: vno } });
        }
      });
    }
    enabled++;
  }

  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN (no writes)'}`);
  console.log(`  receipts total ............ ${receipts.length}`);
  console.log(`  already had adjMode ....... ${alreadyOk}`);
  console.log(`  reconciled -> ENABLED ..... ${enabled}`);
  console.log(`  did NOT reconcile -> left locked ... ${skipped}`);
  console.log(`  party has un-attributable advance rows -> left locked ... ${poisoned} (${poisonedParties.size} parties)`);
  if (skipDetail.length) {
    console.log('\n  sample of the ones left locked:');
    for (const s of skipDetail) console.log(`    ${s}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
