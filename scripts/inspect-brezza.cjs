const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.orderItem.findMany({
    where: {
      OR: [
        { productName: { contains: 'BREZZA' } },
        { product: { contains: 'BREZZA' } }
      ]
    },
    include: {
      order: { select: { id: true, code: true, customerId: true, customerName: true } },
      photos: true
    }
  });

  console.log(`Found ${items.length} BREZZA order items:`);
  for (const it of items) {
    console.log({
      id: it.id,
      orderCode: it.order?.code,
      customer: it.order?.customerName,
      productName: it.productName,
      product: it.product,
      design: it.design,
      designType: it.designType,
      photosCount: it.photos.length,
      photos: it.photos.map(p => ({ id: p.id, url: p.url, filename: p.filename }))
    });
  }

  // Also query all orderItemPhotos where orderItem has customerId
  const allPhotos = await prisma.orderItemPhoto.findMany({
    where: {
      orderItem: {
        OR: [
          { productName: { contains: 'BREZZA' } },
          { product: { contains: 'BREZZA' } }
        ]
      }
    },
    include: {
      orderItem: { select: { id: true, productName: true, design: true, designType: true, order: { select: { customerId: true, customerName: true } } } }
    }
  });
  console.log('\nAll BREZZA Photos in DB count:', allPhotos.length);
  for (const p of allPhotos) {
    console.log({
      photoId: p.id,
      orderItemId: p.orderItemId,
      customer: p.orderItem.order?.customerName,
      productName: p.orderItem.productName,
      design: p.orderItem.design,
      designType: p.orderItem.designType,
      filename: p.filename,
      url: p.url
    });
  }
}

main().finally(() => prisma.$disconnect());
