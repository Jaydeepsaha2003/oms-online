const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check item 3508 priority
  const item = await prisma.orderItem.findUnique({
    where: { id: 3508 },
    include: { order: true }
  });
  console.log('Item 3508 item.priority:', item.priority, '| order.priority:', item.order.priority);
}

main().finally(() => prisma.$disconnect());
