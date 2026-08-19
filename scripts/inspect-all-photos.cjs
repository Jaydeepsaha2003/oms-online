const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const photos = await prisma.orderItemPhoto.findMany({
    orderBy: { id: 'asc' },
    include: { orderItem: { include: { order: true } } }
  });

  console.log(`Total photos in DB: ${photos.length}`);
  for (const p of photos) {
    const item = p.orderItem;
    const order = item?.order;
    console.log(`Photo #${p.id} [${p.createdAt.toISOString()}] filename="${p.filename}"`);
    console.log(`   url: ${p.url}`);
    console.log(`   orderItemId: ${p.orderItemId} -> Order #${order?.id} (${order?.code}) Customer: "${order?.customerName}" Product: "${item?.productName || item?.product}"`);
  }
}

main().finally(() => prisma.$disconnect());
