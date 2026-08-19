const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prismaDir = path.join(__dirname, '..', 'apps', 'api', 'prisma');
const backupsDir = path.join(__dirname, '..', 'backups');
const currentDbPath = path.join(prismaDir, 'dev.db');

const currentPrisma = new PrismaClient({
  datasources: { db: { url: `file:${currentDbPath}` } }
});

async function getAllBackupPhotos() {
  const backupFiles = [
    path.join(prismaDir, 'dev.db.bak-before-restore-order-1246'),
    path.join(prismaDir, 'dev.db.bak-before-dedupe-trans-rates'),
    path.join(prismaDir, 'dev.db.bak-before-dispatch-alerts'),
    path.join(backupsDir, 'dev-2026-08-14_05-01-34.db'),
    path.join(backupsDir, 'oms-weekly-backup-2026-08-13.db'),
    path.join(backupsDir, 'oms-weekly-backup-2026-08-06.db'),
    path.join(backupsDir, 'oms-weekly-backup-2026-07-30.db'),
  ];

  const allBackupPhotoMap = new Map(); // path -> { path, filename, mimeType, size, productName, product, orderCode, customerName, orderId }

  for (const bFile of backupFiles) {
    if (!fs.existsSync(bFile)) continue;
    const bPrisma = new PrismaClient({
      datasources: { db: { url: `file:${bFile}` } }
    });

    try {
      const photos = await bPrisma.$queryRawUnsafe(`SELECT * FROM order_item_photos`);
      for (const p of photos) {
        if (!allBackupPhotoMap.has(p.path)) {
          // get item details
          const items = await bPrisma.$queryRawUnsafe(`SELECT * FROM order_items WHERE id = ${p.orderItemId}`);
          const item = items[0];
          if (item) {
            const orders = await bPrisma.$queryRawUnsafe(`SELECT * FROM orders WHERE id = ${item.orderId}`);
            const order = orders[0];
            allBackupPhotoMap.set(p.path, {
              path: p.path,
              url: p.url,
              filename: p.filename,
              mimeType: p.mimeType,
              size: p.size,
              orderItemId: p.orderItemId,
              orderId: item.orderId,
              orderCode: order?.code,
              customerName: order?.customerName,
              productName: item.productName || item.product,
              product: item.product,
              design: item.design,
              backupSource: path.basename(bFile)
            });
          }
        }
      }
    } catch (err) {
      // ignore
    } finally {
      await bPrisma.$disconnect();
    }
  }

  return allBackupPhotoMap;
}

async function main() {
  console.log('=== SYSTEM-WIDE CROSS-VERIFICATION OF ALL ORDER PHOTOS ===\n');

  const backupPhotoMap = await getAllBackupPhotos();
  console.log(`Found ${backupPhotoMap.size} unique photo entries across all historical database backups.`);

  const currentPhotos = await currentPrisma.orderItemPhoto.findMany();
  const currentPhotoPaths = new Set(currentPhotos.map((p) => p.path));

  console.log(`Current dev.db has ${currentPhotos.length} photo entries.`);

  const missingPhotos = [];
  for (const [pathKey, bPhoto] of backupPhotoMap.entries()) {
    if (!currentPhotoPaths.has(pathKey)) {
      missingPhotos.push(bPhoto);
    }
  }

  console.log(`\nIdentified ${missingPhotos.length} photos present in backups that are NOT linked in current dev.db:`);

  let restoredCount = 0;
  for (const m of missingPhotos) {
    // Check if the image file exists on disk
    const diskPath = path.join(__dirname, '..', 'apps', 'api', m.path);
    const rootDiskPath = path.join(__dirname, '..', m.path);
    const fileExists = fs.existsSync(diskPath) || fs.existsSync(rootDiskPath);

    console.log(`\nMissing photo: "${m.filename}" (${m.path})`);
    console.log(`   Backup Source: ${m.backupSource} | Customer: "${m.customerName}" | Product: "${m.productName}"`);
    console.log(`   File exists on disk: ${fileExists}`);

    if (!fileExists) {
      console.log(`   [SKIP] File missing on disk.`);
      continue;
    }

    // Try to find matching active order and line item in current dev.db
    let targetItem = null;

    // 1. Try matching by orderCode and productName/product
    if (m.orderCode) {
      const activeOrder = await currentPrisma.order.findFirst({
        where: { code: m.orderCode },
        include: { items: true }
      });
      if (activeOrder) {
        targetItem = activeOrder.items.find(
          (i) => (i.productName || i.product) === m.productName || i.product === m.product
        );
      }
    }

    // 2. Try matching by customerName and productName
    if (!targetItem && m.customerName) {
      const customerOrders = await currentPrisma.order.findMany({
        where: { customerName: m.customerName },
        include: { items: true },
        orderBy: { id: 'desc' }
      });
      for (const co of customerOrders) {
        const match = co.items.find(
          (i) => (i.productName || i.product) === m.productName || i.product === m.product
        );
        if (match) {
          targetItem = match;
          break;
        }
      }
    }

    if (targetItem) {
      console.log(`   Found matching active item #${targetItem.id} on Order #${targetItem.orderId}: "${targetItem.productName || targetItem.product}"`);

      // Check if photo is already attached to targetItem
      const existingOnItem = await currentPrisma.orderItemPhoto.findFirst({
        where: { orderItemId: targetItem.id, path: m.path }
      });

      if (!existingOnItem) {
        const created = await currentPrisma.orderItemPhoto.create({
          data: {
            orderItemId: targetItem.id,
            path: m.path,
            url: m.url || `/api/uploads/${m.path}`,
            filename: m.filename || 'photo.jpg',
            mimeType: m.mimeType || 'image/jpeg',
            size: m.size || 0,
          }
        });
        console.log(`   ✓ RESTORED photo #${created.id} -> Item #${targetItem.id} (Order #${targetItem.orderId})`);
        restoredCount++;
      } else {
        console.log(`   Photo already attached.`);
      }
    } else {
      console.log(`   [UNLINKED] No matching active item found in current DB for ${m.customerName} / ${m.productName}`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`CROSS-VERIFICATION COMPLETE: Restored ${restoredCount} missing photo links across all orders.`);
  console.log(`==================================================`);
}

main().finally(() => currentPrisma.$disconnect());
