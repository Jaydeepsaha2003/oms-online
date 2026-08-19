const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findUnique({
    where: { id: 1175 },
    include: { items: true }
  });
  console.log('=== ORDER 1175 ===');
  console.log('Order Priority:', order.priority);
  for (const item of order.items) {
    console.log(`Item #${item.id} (${item.productName}): priority="${item.priority}"`);
  }
}

main().finally(() => prisma.$disconnect());
