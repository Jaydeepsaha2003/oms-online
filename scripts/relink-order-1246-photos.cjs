const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.orderItem.findMany({
    where: { orderId: 1246 },
    orderBy: { id: 'asc' }
  });
  console.log(`Order 1246 has ${items.length} items.`);

  const photosToInsert = [
    {
      orderItemId: items[0].id, // #3760
      path: 'order-items/13934aec-6242-4189-857b-cea5507be715.jpg',
      url: '/api/uploads/order-items/13934aec-6242-4189-857b-cea5507be715.jpg',
      filename: 'photo-1.jpg',
      mimeType: 'image/jpeg',
      size: 124438
    },
    {
      orderItemId: items[1]?.id || items[0].id, // #3770
      path: 'order-items/28b52906-505c-4e1b-819a-2dce17435254.jpg',
      url: '/api/uploads/order-items/28b52906-505c-4e1b-819a-2dce17435254.jpg',
      filename: 'photo-2.jpg',
      mimeType: 'image/jpeg',
      size: 104464
    },
    {
      orderItemId: items[2]?.id || items[0].id, // #3771
      path: 'order-items/a81849df-74b2-4725-8e7c-f19d13075787.jpg',
      url: '/api/uploads/order-items/a81849df-74b2-4725-8e7c-f19d13075787.jpg',
      filename: 'photo-3.jpg',
      mimeType: 'image/jpeg',
      size: 124438
    },
    {
      orderItemId: items[3]?.id || items[0].id, // #3772
      path: 'order-items/ac722745-6e0d-4fa1-936b-7cbb7b71eb18.jpg',
      url: '/api/uploads/order-items/ac722745-6e0d-4fa1-936b-7cbb7b71eb18.jpg',
      filename: 'photo-4.jpg',
      mimeType: 'image/jpeg',
      size: 104464
    }
  ];

  for (const p of photosToInsert) {
    const created = await prisma.orderItemPhoto.create({ data: p });
    console.log(`Linked photo #${created.id} to item #${created.orderItemId}: ${created.url}`);
  }
}

main().finally(() => prisma.$disconnect());
