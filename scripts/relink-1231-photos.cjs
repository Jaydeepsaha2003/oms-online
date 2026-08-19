const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const item3728 = await prisma.orderItem.findUnique({ where: { id: 3728 } });
  const item3729 = await prisma.orderItem.findUnique({ where: { id: 3729 } });
  const item3730 = await prisma.orderItem.findUnique({ where: { id: 3730 } });
  const item3731 = await prisma.orderItem.findUnique({ where: { id: 3731 } });

  const photosToRestore = [
    {
      orderItemId: item3728.id, // 10 ICE WL+TOOL
      path: 'order-items/152b3866-c391-4c97-9ea1-a2b1445ccb07.jpg',
      url: '/api/uploads/order-items/152b3866-c391-4c97-9ea1-a2b1445ccb07.jpg',
      filename: 'ICE WL+TOOL.jpeg',
      mimeType: 'image/jpeg',
      size: 136530
    },
    {
      orderItemId: item3729.id, // 8 ICE WL+TOOL
      path: 'order-items/2df9411e-eb0e-4daf-af3e-213aaf08869f.jpg',
      url: '/api/uploads/order-items/2df9411e-eb0e-4daf-af3e-213aaf08869f.jpg',
      filename: 'ICE WL+TOOL.jpeg',
      mimeType: 'image/jpeg',
      size: 136530
    },
    {
      orderItemId: item3730.id, // 10 BREZZA WL+LASER
      path: 'order-items/6f9fc9f4-7e0d-4c8e-a9ea-b31622dd729b.jpg',
      url: '/api/uploads/order-items/6f9fc9f4-7e0d-4c8e-a9ea-b31622dd729b.jpg',
      filename: 'BREZZA WL.jpeg',
      mimeType: 'image/jpeg',
      size: 643773
    },
    {
      orderItemId: item3731.id, // 8 BREZZA WL+LASER
      path: 'order-items/5a30e4a1-68ae-4751-8f0d-98a2b8c39db1.jpg',
      url: '/api/uploads/order-items/5a30e4a1-68ae-4751-8f0d-98a2b8c39db1.jpg',
      filename: 'BREZZA WL.jpeg',
      mimeType: 'image/jpeg',
      size: 643773
    }
  ];

  console.log('Restoring 4 photos for Order 1231 (ANIL METAL)...');
  for (const p of photosToRestore) {
    const created = await prisma.orderItemPhoto.create({ data: p });
    console.log(`✓ Restored photo #${created.id} ("${created.filename}") -> item #${created.orderItemId}`);
  }

  const order1231 = await prisma.order.findUnique({
    where: { id: 1231 },
    include: { items: { include: { photos: true } } }
  });

  console.log('\n=== VERIFIED ORDER 1231 PHOTOS IN DB ===');
  for (const item of order1231.items) {
    if (item.photos.length > 0) {
      console.log(`Item #${item.id} (${item.productName || item.product}):`);
      for (const p of item.photos) {
        console.log(`   Photo #${p.id}: filename="${p.filename}", url="${p.url}"`);
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
