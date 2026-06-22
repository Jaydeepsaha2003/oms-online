const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const rows = [
  ['COMPLETION_DAYS', '3', 0], ['COMPLETION_DAYS', '5', 1], ['COMPLETION_DAYS', '7', 2],
  ['COMPLETION_DAYS', '10', 3], ['COMPLETION_DAYS', '15', 4], ['COMPLETION_DAYS', '30', 5],
  ['ORDER_TYPE', 'SALES ORDER', 0], ['ORDER_TYPE', 'SAMPLE ORDER', 1],
];
(async () => {
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "order_options" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "group" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`);
  await p.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "order_options_group_value_key" ON "order_options"("group", "value")');
  await p.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "order_options_group_idx" ON "order_options"("group")');
  for (const [group, value, sortOrder] of rows) {
    await p.$executeRawUnsafe(
      'INSERT OR IGNORE INTO "order_options" ("group","value","sortOrder","updatedAt") VALUES (?,?,?,CURRENT_TIMESTAMP)',
      group, value, sortOrder,
    );
  }
  const cnt = await p.$queryRawUnsafe('SELECT COUNT(*) as c FROM order_options');
  console.log('order_options rows now:', Number(cnt[0].c));
  await p.$disconnect();
})().catch((e) => { console.error(String(e)); process.exit(1); });
