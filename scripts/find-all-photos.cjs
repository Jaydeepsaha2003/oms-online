const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const dir = 'd:\\oms-online\\uploads\\order-items';
  const files = fs.readdirSync(dir);
  const dbPhotos = await prisma.orderItemPhoto.findMany({
    include: { orderItem: { include: { order: true } } }
  });

  const photoMap = new Map();
  for (const p of dbPhotos) {
    const filenameOnDisk = p.path.replace('order-items/', '');
    photoMap.set(filenameOnDisk, p);
  }

  console.log(`=== ALL 85 FILES IN UPLOADS/ORDER-ITEMS ===\n`);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const stat = fs.statSync(path.join(dir, file));
    const p = photoMap.get(file);
    if (p) {
      console.log(`[${i+1}] ${stat.mtime.toISOString().slice(0,16)} | DB Photo #${p.id} | Order #${p.orderItem?.orderId} (${p.orderItem?.order?.code || '?'}) | "${p.orderItem?.productName || p.orderItem?.product}" | origFilename="${p.filename}" | file=${file}`);
    } else {
      console.log(`[${i+1}] ${stat.mtime.toISOString().slice(0,16)} | UNLINKED / ORPHANED | file=${file} | size=${stat.size} bytes`);
    }
  }
}

main().finally(() => prisma.$disconnect());
