const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getPhotosForLine(item) {
  // 1. Direct photos
  const direct = await prisma.orderItemPhoto.findMany({
    where: { orderItemId: item.id },
    select: { id: true, url: true, path: true, filename: true }
  });

  if (direct.length > 0) {
    return { photos: direct, fromHistory: false };
  }

  // 2. Historical photos for same customer + product
  if (!item.order?.customerId) return { photos: [], fromHistory: false };

  const history = await prisma.orderItemPhoto.findMany({
    where: {
      orderItem: {
        order: { customerId: item.order.customerId },
        OR: [
          { productName: item.productName },
          { product: item.product }
        ]
      }
    },
    select: { id: true, url: true, path: true, filename: true },
    orderBy: { id: 'desc' },
    take: 5
  });

  return { photos: history, fromHistory: true };
}

async function main() {
  const item3508 = await prisma.orderItem.findUnique({
    where: { id: 3508 },
    include: { order: true }
  });
  console.log('=== Item 3508 (KALAKRITI 15 DAMRU WL+LOGO) ===');
  console.log(await getPhotosForLine(item3508));

  // Check an order item that HAS direct photos (e.g. 3728)
  const item3728 = await prisma.orderItem.findUnique({
    where: { id: 3728 },
    include: { order: true }
  });
  console.log('\n=== Item 3728 (ANIL METAL 10 ICE WL+TOOL) ===');
  console.log(await getPhotosForLine(item3728));
}

main().finally(() => prisma.$disconnect());
