const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const order1231 = await prisma.order.findUnique({
    where: { id: 1231 },
    include: { items: { include: { photos: true } } }
  });
  console.log('=== ORDER 1231 DETAILS ===');
  console.log('Code:', order1231.code, 'Customer:', order1231.customerName, 'Status:', order1231.status);
  console.log('Comment:', order1231.comment, 'PO:', order1231.poNumber);

  // Check matching quotations for ANIL METAL around Aug 14
  const quos = await prisma.quotation.findMany({
    where: { customerName: { contains: 'ANIL' } },
    include: { items: true }
  });
  console.log('\n=== QUOTATIONS FOR ANIL METAL ===');
  for (const q of quos) {
    console.log(`Quotation #${q.id} (${q.code}) Status: ${q.status} ConvertedOrderId: ${q.convertedOrderId}`);
    for (const i of q.items) {
      console.log(`   Item #${i.id}: ${i.productName || i.product}`);
    }
  }

  // Check order_item_changes for order 1231
  const changes = await prisma.orderItemChange.findMany({
    where: { orderId: 1231 }
  });
  console.log('\n=== ORDER ITEM CHANGES FOR 1231 ===', changes);
}

main().finally(() => prisma.$disconnect());
