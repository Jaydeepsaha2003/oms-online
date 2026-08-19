const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    include: {
      items: {
        include: { photos: true }
      }
    },
    orderBy: { id: 'desc' }
  });

  console.log('=== SYSTEM-WIDE VERIFICATION SUMMARY: ORDERS WITH PHOTOS ===\n');

  let ordersWithPhotos = 0;
  let totalPhotosInDb = 0;

  for (const o of orders) {
    let orderPhotoCount = 0;
    for (const item of o.items) {
      orderPhotoCount += item.photos.length;
    }
    if (orderPhotoCount > 0) {
      ordersWithPhotos++;
      totalPhotosInDb += orderPhotoCount;
      console.log(`Order #${o.id} (${o.code}) | Customer: "${o.customerName}" | Total Photos: ${orderPhotoCount}`);
      for (const item of o.items) {
        if (item.photos.length > 0) {
          console.log(`   Item #${item.id} (${item.productName || item.product}): ${item.photos.length} photo(s)`);
          for (const p of item.photos) {
            console.log(`      ✓ Photo #${p.id}: filename="${p.filename}", url="${p.url}"`);
          }
        }
      }
      console.log('');
    }
  }

  console.log(`==================================================`);
  console.log(`TOTAL ORDERS WITH VALID PHOTOS: ${ordersWithPhotos}`);
  console.log(`TOTAL ACTIVE ATTACHED PHOTOS IN DB: ${totalPhotosInDb}`);
  console.log(`==================================================`);
}

main().finally(() => prisma.$disconnect());
