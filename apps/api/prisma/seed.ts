/**
 * Database seed.
 * Run with `npm run db:seed`. Idempotent — safe to run repeatedly, including on
 * every production restart (start.bat / restart.bat run this whenever their
 * DB-sync stamp is stale).
 *
 *   1. Upserts every permission in the shared catalog.
 *   2. Creates the built-in system roles on first run only, with their default
 *      permission grants. Once a system role already exists, its permissions
 *      are NOT touched again here — they belong to whoever edits that role from
 *      the Roles & Permissions screen from then on. Re-wiping them on every
 *      restart would silently discard an admin's in-app customization, which is
 *      not acceptable in production.
 *   3. Creates the bootstrap admin (super_admin) from SEED_ADMIN_* env vars on
 *      first run only. An admin that already exists keeps the password and PIN
 *      it has now — this seed will NOT push SEED_ADMIN_PASSWORD back over a
 *      password changed from the app. Run reset-admin-password.bat (which sets
 *      SEED_ADMIN_FORCE_RESET=1) if that password is ever forgotten.
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

/**
 * Remove Permission rows for resources/actions no longer in the shared catalog
 * (e.g. a feature that got pulled). This is NOT the same as resetting a role's
 * customized grants — it only deletes permissions that no longer correspond to
 * anything in the app at all. Cascades to RolePermission automatically.
 */
async function pruneRemovedPermissions() {
  const catalogKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));
  const all = await prisma.permission.findMany({ select: { id: true, key: true } });
  const stale = all.filter((p) => !catalogKeys.has(p.key));
  if (!stale.length) return;
  await prisma.permission.deleteMany({ where: { id: { in: stale.map((p) => p.id) } } });
  console.log(`✓ Pruned ${stale.length} permission(s) no longer in the catalog: ${stale.map((p) => p.key).join(', ')}`);
}

async function seedRoles() {
  // Map permission key -> id for fast lookup.
  const allPerms = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(allPerms.map((p) => [p.key, p.id]));

  let created = 0;
  let toppedUp = 0;
  for (const role of SYSTEM_ROLES) {
    const existing = await prisma.role.findUnique({ where: { name: role.name } });
    const record = await prisma.role.upsert({
      where: { name: role.name },
      // Label/description/isSystem stay in sync with the definition even after
      // creation — only the permission GRANTS are first-run-only (see below).
      update: { label: role.label, description: role.description, isSystem: role.isSystem },
      create: {
        name: role.name,
        label: role.label,
        description: role.description,
        isSystem: role.isSystem,
      },
    });

    const keys = role.permissions === ALL_PERMISSIONS ? ALL_PERMISSION_KEYS : role.permissions;
    const permissionIds = keys.map((k) => idByKey.get(k)).filter((id): id is string => Boolean(id));

    if (!existing) {
      created++;
      if (permissionIds.length) {
        await prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: record.id, permissionId })),
        });
      }
      continue;
    }

    // The role already exists, so its grants are whatever an admin has settled
    // on — do NOT replace them. The one exception is super admin, whose whole
    // definition is "everything": it holds the expanded key list rather than a
    // wildcard, so a permission added by a later release would never reach it
    // and its own new screens would be invisible to it. Top up the missing keys
    // (additive only — nothing is ever revoked here). The API separately refuses
    // to narrow this role, so there is no customization to preserve.
    if (role.permissions !== ALL_PERMISSIONS) continue;
    const held = new Set(
      (await prisma.rolePermission.findMany({ where: { roleId: record.id }, select: { permissionId: true } })).map((r) => r.permissionId),
    );
    const missing = permissionIds.filter((id) => !held.has(id));
    if (missing.length) {
      await prisma.rolePermission.createMany({ data: missing.map((permissionId) => ({ roleId: record.id, permissionId })) });
      toppedUp += missing.length;
    }
  }
  console.log(
    `✓ Roles: ${created} created with default permissions, ${SYSTEM_ROLES.length - created} already existed (grants left as-is)` +
      (toppedUp ? `; super admin topped up with ${toppedUp} new permission(s)` : ''),
  );
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

  // Recovery hatch: only a deliberate SEED_ADMIN_FORCE_RESET=1 puts the
  // credentials back to the .env values (see reset-admin-password.bat).
  const forceReset = process.env.SEED_ADMIN_FORCE_RESET === '1';
  const existed = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  const user = await prisma.user.upsert({
    where: { email },
    // BOOTSTRAP ONLY — credentials are set when this row is first created and
    // never rewritten afterwards. This seed re-runs on every start.bat whose
    // DB-sync stamp is stale, so re-hashing SEED_ADMIN_PASSWORD here silently
    // threw away a password the admin had changed in the app: it reverted to
    // the .env default on the next reboot, every time.
    update: forceReset ? { passwordHash, ...(pinHash ? { pinHash } : {}) } : { name },
    create: { email, name, passwordHash, status: 'active', ...(pinHash ? { pinHash } : {}) },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: superAdmin.id } },
    update: {},
    create: { userId: user.id, roleId: superAdmin.id },
  });

  if (!existed) {
    console.log(`✓ Admin user created: ${email}`);
    console.log(`  (password from SEED_ADMIN_PASSWORD — change it after first login)`);
    if (pinHash) console.log(`  quick-login PIN set from SEED_ADMIN_PIN`);
  } else if (forceReset) {
    console.log(`✓ Admin password RESET to SEED_ADMIN_PASSWORD (forced): ${email}`);
    if (pinHash) console.log(`  quick-login PIN also reset from SEED_ADMIN_PIN`);
  } else {
    console.log(`✓ Admin user ready: ${email} — existing password left untouched`);
  }
}

async function main() {
  console.log('Seeding OMS database…');
  await seedPermissions();
  await pruneRemovedPermissions();
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
