/**
 * Read-only health check for a deployment. Writes NOTHING.
 *
 * Answers, in one go, the questions that are impossible to settle remotely:
 * is the new code actually built and running, has the payments repair been
 * applied here, and what can the account that's hitting an error actually do.
 *
 *   cd apps/api && npx tsx scripts/diagnose.ts
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = join(__dirname, '..', '..', '..');
const ok = (b: boolean) => (b ? 'YES' : 'NO');
const line = () => console.log('-'.repeat(64));

function countIn(path: string, needle: string): number | null {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return (readFileSync(full, 'utf8').match(new RegExp(needle, 'g')) ?? []).length;
}

async function main() {
  console.log('\n=== OMS deployment diagnosis ===\n');

  // 1. Which commit is checked out here?
  try {
    const head = execSync('git log --oneline -1', { cwd: ROOT }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
    console.log(`git branch ......... ${branch}`);
    console.log(`git HEAD ........... ${head}`);
    console.log(`uncommitted changes  ${dirty ? 'YES (local edits present)' : 'no'}`);
  } catch {
    console.log('git ................ (not a git checkout / git unavailable)');
  }
  line();

  // 2. Is the permission fix in the SOURCE, and in the BUILD the server runs?
  const inSrc = countIn('apps/api/src/orders/orders.controller.ts', 'AnyPermission');
  const inDist = countIn('apps/api/dist/src/orders/orders.controller.js', 'AnyPermission');
  console.log(`photo-permission fix in SOURCE ... ${inSrc === null ? 'file missing' : `${inSrc} refs -> ${ok(inSrc > 0)}`}`);
  console.log(`photo-permission fix in BUILD .... ${inDist === null ? 'apps/api/dist NOT BUILT' : `${inDist} refs -> ${ok(inDist > 0)}`}`);
  if (inDist !== null && inDist === 0) console.log('   ^ the running server is serving OLD code — rebuild is what is missing');
  const webBuilt = existsSync(join(ROOT, 'apps/web/dist/index.html'));
  console.log(`web bundle present ............... ${ok(webBuilt)}`);
  line();

  const prisma = new PrismaClient();

  // 3. Payments: are the Receive Payment edit/delete buttons unlockable here?
  const totalReceipts = await prisma.acctLedger.count({ where: { voucherType: 'RECEIPT' } });
  const unlocked = await prisma.acctLedger.count({ where: { voucherType: 'RECEIPT', adjMode: { not: null } } });
  console.log(`receipts ......................... ${totalReceipts}`);
  console.log(`  editable/deletable (adjMode set)  ${unlocked}`);
  console.log(`  still locked ...................  ${totalReceipts - unlocked}`);
  if (totalReceipts > 0 && unlocked === 0) {
    console.log('   ^ the backfill has NOT been run on this database. Edit/Delete will stay');
    console.log('     disabled until:  npx tsx scripts/backfill-receipt-edit-support.ts --apply');
  }
  line();

  // 4. Who exists, and what can they actually do?
  const users = await prisma.user.findMany({ include: { roles: { include: { role: true } } } });
  console.log(`users (${users.length}):`);
  for (const u of users) {
    console.log(`  ${u.email}  name="${u.name}"  status=${u.status}  roles=${u.roles.map((r) => r.role.label).join(', ') || '(NONE)'}`);
  }
  line();

  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
  console.log('roles — the permissions that decide the dispatch-photo upload:');
  for (const r of roles) {
    const keys = r.permissions.map((x) => x.permission.key);
    const can = (k: string) => (keys.includes(k) || keys.includes('*') || keys.includes(`${k.split(':')[0]}:manage`) ? 'yes' : 'NO ');
    console.log(
      `  ${r.label.padEnd(22)} users=${String(r._count.users).padEnd(3)} ` +
        `order:update=${can('order:update')} dispatch:create=${can('dispatch:create')} total=${keys.length}`,
    );
  }
  console.log('\n  (uploading a dispatch photo needs EITHER of those two, once the fix is running)');
  line();
  console.log('\nPaste this whole output back and it will pin down what is still wrong.\n');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('diagnosis failed:', e.message);
  process.exit(1);
});
