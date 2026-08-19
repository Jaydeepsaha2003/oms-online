const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const customer = await prisma.customer.findFirst({
    where: { partyName: { contains: 'KALAKRITI' } }
  });
  console.log('Customer:', customer);

  const orders = await prisma.order.findMany({
    where: { customerName: { contains: 'KALAKRITI' } },
    include: {
      items: {
        include: { dispatches: true }
      }
    },
    orderBy: { id: 'desc' }
  });

  console.log(`Found ${orders.length} orders for KALAKRITI:`);
  for (const o of orders) {
    console.log(`\nOrder #${o.id} (${o.code}) | Date: ${o.createdAt.toISOString()} | Status: ${o.status}`);
    for (const item of o.items) {
      if ((item.productName || '').includes('15 DAMRU') || (item.product || '').includes('DAMRU')) {
        console.log(`   Item #${item.id}: productName="${item.productName}", product="${item.product}", bags=${item.bags}, pcs=${item.pcs}`);
        console.log(`   Dispatches count: ${item.dispatches.length}`);
        for (const d of item.dispatches) {
          console.log(`      Dispatch #${d.id}: bags=${d.bags}, pcs=${d.pcs}, status="${d.dispatchStatus}", date=${d.dispatchDate}`);
        }
      }
    }
  }

  // Also check design track entries for these items
  const entries = await prisma.designTrackEntry.findMany();
  console.log('\nAll DesignTrackEntries in DB:', entries);
}

main().finally(() => prisma.$disconnect());
