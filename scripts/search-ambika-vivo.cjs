const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prismaDir = 'd:\\oms-online\\apps\\api\\prisma';
const backupsDir = 'd:\\oms-online\\backups';
const steelBackupsDir = 'd:\\steel-erp-standalone\\backups';
const downloadsDir = 'C:\\Users\\USER\\Downloads';

// 1. Search SQLite databases for AMBIKA METAL / 7 VIVO MATT
async function searchSqliteDb(dbPath) {
  if (!fs.existsSync(dbPath)) return;
  console.log(`\n==================================================`);
  console.log(`SEARCHING SQLITE DB: ${dbPath}`);
  console.log(`==================================================`);

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } }
  });

  try {
    // Check orders / order_items for AMBIKA
    const orders = await prisma.$queryRawUnsafe(`
      SELECT o.id as orderId, o.code, o.customerName, o.createdAt as orderCreatedAt,
             i.id as itemId, i.product, i.design, i.productName, i.subCategory, i.bags, i.pcs, i.rate
      FROM orders o
      JOIN order_items i ON o.id = i.orderId
      WHERE o.customerName LIKE '%AMBIKA%'
         OR i.productName LIKE '%VIVO%'
         OR i.product LIKE '%VIVO%'
         OR i.design LIKE '%MATT%'
    `);
    console.log(`Found ${orders.length} order item matches in ${path.basename(dbPath)}:`);
    for (const r of orders) {
      console.log(`  Order #${r.orderId} (${r.code}) | Customer: ${r.customerName} | Item #${r.itemId}: "${r.productName || r.product}" design="${r.design}" bags=${r.bags} rate=${r.rate} createdAt=${r.orderCreatedAt}`);
    }

    // Check quotations / quotation_items for AMBIKA
    try {
      const quos = await prisma.$queryRawUnsafe(`
        SELECT q.id as quoId, q.code, q.customerName, q.createdAt as quoCreatedAt,
               i.id as itemId, i.product, i.design, i.productName, i.bags, i.pcs, i.rate
        FROM quotations q
        JOIN quotation_items i ON q.id = i.quotationId
        WHERE q.customerName LIKE '%AMBIKA%'
           OR i.productName LIKE '%VIVO%'
           OR i.product LIKE '%VIVO%'
           OR i.design LIKE '%MATT%'
      `);
      console.log(`Found ${quos.length} quotation item matches in ${path.basename(dbPath)}:`);
      for (const r of quos) {
        console.log(`  Quotation #${r.quoId} (${r.code}) | Customer: ${r.customerName} | Item #${r.itemId}: "${r.productName || r.product}" design="${r.design}" bags=${r.bags} rate=${r.rate} createdAt=${r.quoCreatedAt}`);
      }
    } catch (e) {
      // quotation tables might not exist in older backups
    }

    // Check order_item_changes if table exists
    try {
      const changes = await prisma.$queryRawUnsafe(`
        SELECT * FROM order_item_changes
        WHERE oldValue LIKE '%AMBIKA%' OR newValue LIKE '%AMBIKA%'
           OR oldValue LIKE '%VIVO%' OR newValue LIKE '%VIVO%'
           OR oldValue LIKE '%MATT%' OR newValue LIKE '%MATT%'
           OR itemLabel LIKE '%AMBIKA%' OR itemLabel LIKE '%VIVO%' OR itemLabel LIKE '%MATT%'
      `);
      console.log(`Found ${changes.length} order_item_changes matches in ${path.basename(dbPath)}`);
      for (const c of changes) {
        console.log(`  Change #${c.id} Order #${c.orderId} kind=${c.kind} field=${c.field} old="${c.oldValue}" new="${c.newValue}" label="${c.itemLabel}" by=${c.changedByName}`);
      }
    } catch (e) {}

  } catch (err) {
    console.error(`Error querying ${path.basename(dbPath)}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

// 2. Search SQL text backup files in steel-erp-standalone
function searchSqlFiles(dir) {
  if (!fs.existsSync(dir)) return;
  console.log(`\n==================================================`);
  console.log(`SEARCHING SQL FILES IN: ${dir}`);
  console.log(`==================================================`);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'));
  for (const f of files) {
    const full = path.join(dir, f);
    const content = fs.readFileSync(full, 'utf8');
    if (content.toLowerCase().includes('ambika') || content.toLowerCase().includes('vivo') || content.toLowerCase().includes('matt')) {
      const lines = content.split('\n');
      const matches = lines.filter(l => (l.toLowerCase().includes('ambika') && (l.toLowerCase().includes('vivo') || l.toLowerCase().includes('matt'))));
      if (matches.length > 0) {
        console.log(`MATCH IN ${f} (${matches.length} lines):`);
        for (const m of matches.slice(0, 10)) {
          console.log('   ', m.slice(0, 200));
        }
      }
    }
  }
}

async function main() {
  const dbFiles = [
    path.join(prismaDir, 'dev.db'),
    path.join(prismaDir, 'dev.db.bak-before-restore-order-1246'),
    path.join(prismaDir, 'dev.db.bak-before-dedupe-trans-rates'),
    path.join(prismaDir, 'dev.db.bak-before-dispatch-alerts'),
    path.join(backupsDir, 'oms-weekly-backup-2026-08-13.db'),
    path.join(backupsDir, 'dev-2026-08-14_05-01-34.db'),
    path.join(downloadsDir, 'oms-backup-2026-08-13-2103.db'),
    path.join(downloadsDir, 'oms-backup-2026-08-08-1308.db')
  ];

  for (const db of dbFiles) {
    await searchSqliteDb(db);
  }

  searchSqlFiles(steelBackupsDir);
}

main();
