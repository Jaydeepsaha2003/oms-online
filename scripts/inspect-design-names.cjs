const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const idx = await p.$queryRawUnsafe("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='design_names'");
  console.log('indexes on design_names:');
  for (const i of idx) console.log('  ', i.name, '::', i.sql);
  await p.$disconnect();
})().catch((e) => { console.error(String(e)); process.exit(1); });
