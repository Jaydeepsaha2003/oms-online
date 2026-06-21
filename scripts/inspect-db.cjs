const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const cols = await p.$queryRawUnsafe('PRAGMA table_info(settings)');
  console.log('settings columns:', cols.map((c) => c.name).join(', '));
  const sql = await p.$queryRawUnsafe("SELECT sql FROM sqlite_master WHERE name='settings'");
  console.log('DDL:', sql[0] ? sql[0].sql : '(none)');
  await p.$disconnect();
})().catch((e) => { console.error(String(e)); process.exit(1); });
