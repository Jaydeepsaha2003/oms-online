/**
 * Upserts the shared permission catalog and nothing else.
 *
 * `prisma db seed` also re-hashes the seed admin's password from
 * SEED_ADMIN_PASSWORD, which is not something you want to trigger on a live
 * database just to register a newly added permission. Run this instead:
 *
 *   npm run db:seed:permissions -w @oms/api
 *
 * Roles are untouched: super admins hold the `*` wildcard, and any other role
 * gets the new permission granted from the Roles screen.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOG } from '@oms/shared';

const prisma = new PrismaClient();

async function main() {
  let added = 0;
  for (const p of PERMISSION_CATALOG) {
    const existing = await prisma.permission.findUnique({ where: { key: p.key }, select: { id: true } });
    if (!existing) added += 1;
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { resource: p.resource, action: p.action, label: p.label, group: p.group },
      create: { key: p.key, resource: p.resource, action: p.action, label: p.label, group: p.group },
    });
  }
  console.log(`✓ ${PERMISSION_CATALOG.length} permissions in catalog — ${added} newly added.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
