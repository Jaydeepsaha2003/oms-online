const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const photoIdsToRemove = [68, 69, 70, 71];

  console.log(`Removing incorrect photos ${photoIdsToRemove.join(', ')}...`);
  const deleted = await prisma.orderItemPhoto.deleteMany({
    where: { id: { in: photoIdsToRemove } }
  });
  console.log(`Deleted ${deleted.count} incorrect photo records.`);

  const order1246 = await prisma.order.findUnique({
    where: { id: 1246 },
    include: { items: { include: { photos: true } } }
  });

  console.log('\n=== UPDATED ORDER 1246 PHOTOS ===');
  for (const item of order1246.items) {
    if (item.photos.length > 0) {
      console.log(`Item #${item.id} (${item.productName || item.product}):`);
      for (const p of item.photos) {
        console.log(`   Photo #${p.id}: filename="${p.filename}", url="${p.url}"`);
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
