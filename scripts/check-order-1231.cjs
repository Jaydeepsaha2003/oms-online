const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const order1231 = await prisma.order.findUnique({
    where: { id: 1231 },
    include: { items: { include: { photos: true } } }
  });

  console.log('=== ORDER 1231 ===');
  console.log(order1231);

  console.log('\n=== ALL ORDERS FOR ANIL METAL ===');
  const anilOrders = await prisma.order.findMany({
    where: { customerName: { contains: 'ANIL' } },
    include: { items: { include: { photos: true } } },
    orderBy: { id: 'desc' }
  });

  for (const o of anilOrders) {
    console.log(`\nOrder #${o.id} (${o.code}) | Customer: ${o.customerName} | Status: ${o.status}`);
    for (const item of o.items) {
      console.log(`   Item #${item.id} (${item.productName || item.product}): photos count = ${item.photos?.length}`);
      for (const p of item.photos) {
        console.log(`      Photo #${p.id}: filename="${p.filename}", url="${p.url}", path="${p.path}"`);
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
