const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const order1246 = await prisma.order.findUnique({
    where: { id: 1246 },
    include: { items: { include: { photos: true } } }
  });

  console.log(`=== ORDER 1246 PHOTOS ===`);
  for (const item of order1246.items) {
    if (item.photos.length > 0) {
      console.log(`Item #${item.id} (${item.productName || item.product}):`);
      for (const p of item.photos) {
        console.log(`   Photo #${p.id}: filename="${p.filename}", path="${p.path}", url="${p.url}"`);
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
