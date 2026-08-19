const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== ORDER ITEM CHANGES ===');
  const changes = await prisma.orderItemChange.findMany({
    orderBy: { id: 'desc' },
    take: 100
  });
  console.log(`Found ${changes.length} recent changes in order_item_changes:`);
  for (const c of changes) {
    const timeStr = c.createdAt ? c.createdAt.toISOString() : 'N/A';
    console.log(`Change #${c.id} [${timeStr}] Order #${c.orderId} Quotation #${c.quotationId} kind=${c.kind} field=${c.field} old="${c.oldValue}" new="${c.newValue}" label="${c.itemLabel}" by="${c.changedByName}"`);
  }

  console.log('\n=== ALL ORDERS FOR AMBIKA METAL (FULL DETAILS) ===');
  const ambikaOrders = await prisma.order.findMany({
    where: { customerName: { contains: 'AMBIKA' } },
    include: { items: { include: { photos: true } } },
    orderBy: { id: 'desc' }
  });
  for (const o of ambikaOrders) {
    console.log(`\nOrder #${o.id} (${o.code}) | Date: ${o.orderDate.toISOString().slice(0,10)} | Status: ${o.status} | CreatedAt: ${o.createdAt.toISOString()} | UpdatedAt: ${o.updatedAt.toISOString()}`);
    for (const i of o.items) {
      console.log(`   Item #${i.id}: productName="${i.productName}", product="${i.product}", design="${i.design}", bags=${i.bags}, pcs=${i.pcs}, rate=${i.rate}, ordType="${i.ordType}"`);
    }
  }

  console.log('\n=== ALL ORDERS CREATED SINCE AUG 18 ===');
  const recentOrders = await prisma.order.findMany({
    where: { createdAt: { gte: new Date('2026-08-18T00:00:00Z') } },
    include: { items: true },
    orderBy: { id: 'desc' }
  });
  for (const o of recentOrders) {
    console.log(`\nOrder #${o.id} (${o.code}) Customer: "${o.customerName}" CreatedAt: ${o.createdAt.toISOString()}`);
    for (const i of o.items) {
      console.log(`   Item #${i.id}: productName="${i.productName}", product="${i.product}", design="${i.design}", bags=${i.bags}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
