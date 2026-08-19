const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getPhotosForLineWithDesign(item) {
  // 1. Direct photos
  const direct = await prisma.orderItemPhoto.findMany({
    where: { orderItemId: item.id },
    select: { id: true, url: true, path: true, filename: true }
  });

  if (direct.length > 0) {
    return { photos: direct, fromHistory: false };
  }

  // 2. Historical photos for same customer + product + design
  if (!item.order?.customerId) return { photos: [], fromHistory: false };

  const historyPhotos = await prisma.orderItemPhoto.findMany({
    where: {
      orderItem: {
        order: { customerId: item.order.customerId },
        OR: [
          { productName: item.productName },
          { product: item.product }
        ]
      }
    },
    include: {
      orderItem: {
        select: {
          id: true,
          productName: true,
          product: true,
          design: true,
          designType: true
        }
      }
    },
    orderBy: { id: 'desc' },
    take: 50
  });

  // Filter in JS to ensure design type or design name matches
  const targetType = (item.designType ?? '').trim().toUpperCase();
  const targetDesign = (item.design ?? '').trim().toUpperCase();

  const matched = historyPhotos.filter(hp => {
    const hpType = (hp.orderItem.designType ?? '').trim().toUpperCase();
    const hpDesign = (hp.orderItem.design ?? '').trim().toUpperCase();

    // If item has designType, match designType or design
    if (targetType && targetType !== 'NA' && targetType !== 'N/A') {
      if (hpType === targetType || hpDesign === targetType) return true;
    }
    // If item has design, match design or designType
    if (targetDesign && targetDesign !== 'NA' && targetDesign !== 'N/A') {
      if (hpDesign === targetDesign || hpType === targetDesign) return true;
    }
    return false;
  });

  return {
    photos: matched.map(p => ({ id: p.id, url: p.url, filename: p.filename, fromHistory: true })),
    fromHistory: true
  };
}

async function main() {
  const item3730 = await prisma.orderItem.findUnique({
    where: { id: 3730 },
    include: { order: true }
  });
  console.log('=== Item 3730 (ANIL METAL 10 BREZZA WL+LASER) ===');
  console.log(await getPhotosForLineWithDesign(item3730));

  const item3732 = await prisma.orderItem.findUnique({
    where: { id: 3732 },
    include: { order: true }
  });
  console.log('\n=== Item 3732 (ANIL METAL 10 BREZZA WL+FULL LASER+TOOL) ===');
  console.log(await getPhotosForLineWithDesign(item3732));
}

main().finally(() => prisma.$disconnect());
