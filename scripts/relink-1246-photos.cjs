const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const recentPhotos = await prisma.orderItemPhoto.findMany({
    where: {
      createdAt: { gte: new Date('2026-08-18T00:00:00Z') }
    },
    orderBy: { id: 'asc' }
  });

  console.log('=== PHOTOS CREATED SINCE AUG 18 ===');
  for (const p of recentPhotos) {
    const parent = await prisma.orderItem.findUnique({ where: { id: p.orderItemId } });
    console.log(`Photo #${p.id}: filename="${p.filename}", orderItemId=${p.orderItemId}, orderId=${parent?.orderId}, product="${parent?.productName || parent?.product}"`);
    console.log(`   url=${p.url}, createdAt=${p.createdAt.toISOString()}`);
  }
}

main().finally(() => prisma.$disconnect());
