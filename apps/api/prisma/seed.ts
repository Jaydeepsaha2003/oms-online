/**
 * Database seed.
 * Run with `npm run db:seed`. Idempotent — safe to run repeatedly.
 *
 *   1. Upserts every permission in the shared catalog.
 *   2. Creates/updates the built-in system roles and their permission grants.
 *   3. Creates the bootstrap admin (super_admin) from SEED_ADMIN_* env vars.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  ALL_PERMISSION_KEYS,
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  SUPER_ADMIN_ROLE,
  SYSTEM_ROLES,
} from '@oms/shared';

const prisma = new PrismaClient();

async function seedPermissions() {
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { resource: p.resource, action: p.action, label: p.label, group: p.group },
      create: { key: p.key, resource: p.resource, action: p.action, label: p.label, group: p.group },
    });
  }
  console.log(`✓ Permissions seeded (${PERMISSION_CATALOG.length})`);
}

async function seedRoles() {
  // Map permission key -> id for fast lookup.
  const allPerms = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(allPerms.map((p) => [p.key, p.id]));

  for (const role of SYSTEM_ROLES) {
    const record = await prisma.role.upsert({
      where: { name: role.name },
      update: { label: role.label, description: role.description, isSystem: role.isSystem },
      create: {
        name: role.name,
        label: role.label,
        description: role.description,
        isSystem: role.isSystem,
      },
    });

    const keys = role.permissions === ALL_PERMISSIONS ? ALL_PERMISSION_KEYS : role.permissions;
    const permissionIds = keys
      .map((k) => idByKey.get(k))
      .filter((id): id is string => Boolean(id));

    // Replace the role's permission set so it always reflects the definition.
    await prisma.rolePermission.deleteMany({ where: { roleId: record.id } });
    if (permissionIds.length) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: record.id, permissionId })),
      });
    }
  }
  console.log(`✓ Roles seeded (${SYSTEM_ROLES.length})`);
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@oms.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  const name = process.env.SEED_ADMIN_NAME ?? 'System Administrator';

  const superAdmin = await prisma.role.findUnique({ where: { name: SUPER_ADMIN_ROLE } });
  if (!superAdmin) throw new Error('super_admin role missing — seed roles first.');

  const pin = process.env.SEED_ADMIN_PIN;
  const passwordHash = await bcrypt.hash(password, 12);
  const pinHash = pin ? await bcrypt.hash(pin, 12) : null;

  const user = await prisma.user.upsert({
    where: { email },
    update: { name, ...(pinHash ? { pinHash } : {}) },
    create: { email, name, passwordHash, status: 'active', ...(pinHash ? { pinHash } : {}) },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: superAdmin.id } },
    update: {},
    create: { userId: user.id, roleId: superAdmin.id },
  });

  console.log(`✓ Admin user ready: ${email}`);
  console.log(`  (password from SEED_ADMIN_PASSWORD — change it after first login)`);
  if (pinHash) console.log(`  quick-login PIN set from SEED_ADMIN_PIN`);
}

async function main() {
  console.log('Seeding OMS database…');
  await seedPermissions();
  await seedRoles();
  await seedAdmin();
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
