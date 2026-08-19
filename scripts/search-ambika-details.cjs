const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const dbPath = 'd:\\oms-online\\apps\\api\\prisma\\dev.db';
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${dbPath}` } }
});

async function main() {
  console.log('=== ALL ORDERS FOR AMBIKA METAL ===');
  const ambikaOrders = await prisma.order.findMany({
    where: { customerName: { contains: 'AMBIKA' } },
    include: { items: true },
    orderBy: { id: 'desc' }
  });

  console.log(`Total Orders found for AMBIKA: ${ambikaOrders.length}`);
  for (const o of ambikaOrders) {
    console.log(`\nOrder #${o.id} (${o.code}) | Date: ${o.orderDate?.toISOString().slice(0,10)} | Status: ${o.status} | Created: ${o.createdAt?.toISOString()}`);
    for (const item of o.items) {
      console.log(`   Line #${item.id}: "${item.productName || item.product}" | Design: "${item.design}" | Bags: ${item.bags} | Gram: ${item.gram} | Rate: ${item.rate}`);
    }
  }

  console.log('\n\n=== ALL QUOTATIONS FOR AMBIKA METAL ===');
  const ambikaQuos = await prisma.quotation.findMany({
    where: { customerName: { contains: 'AMBIKA' } },
    include: { items: true },
    orderBy: { id: 'desc' }
  });

  console.log(`Total Quotations found for AMBIKA: ${ambikaQuos.length}`);
  for (const q of ambikaQuos) {
    console.log(`\nQuotation #${q.id} (${q.code}) | Date: ${q.quotationDate?.toISOString().slice(0,10)} | Status: ${q.status} | Created: ${q.createdAt?.toISOString()}`);
    for (const item of q.items) {
      console.log(`   Line #${item.id}: "${item.productName || item.product}" | Design: "${item.design}" | Bags: ${item.bags} | Gram: ${item.gram} | Rate: ${item.rate}`);
    }
  }

  console.log('\n\n=== SEARCHING ANY ITEM MATCHING VIVO OR MATT ACROSS ALL CUSTOMERS ===');
  const vivoItems = await prisma.orderItem.findMany({
    where: {
      OR: [
        { product: { contains: 'VIVO' } },
        { productName: { contains: 'VIVO' } },
        { design: { contains: 'MATT' } },
        { productName: { contains: 'MATT' } }
      ]
    },
    include: { order: true },
    orderBy: { id: 'desc' }
  });
  console.log(`Total OrderItems matching VIVO or MATT: ${vivoItems.length}`);
  for (const i of vivoItems) {
    console.log(`OrderItem #${i.id} -> Order #${i.orderId} (${i.order?.code}) Customer: "${i.order?.customerName}" | "${i.productName || i.product}" | design="${i.design}" | Created: ${i.createdAt?.toISOString()}`);
  }

  const vivoQuoItems = await prisma.quotationItem.findMany({
    where: {
      OR: [
        { product: { contains: 'VIVO' } },
        { productName: { contains: 'VIVO' } },
        { design: { contains: 'MATT' } },
        { productName: { contains: 'MATT' } }
      ]
    },
    include: { quotation: true },
    orderBy: { id: 'desc' }
  });
  console.log(`Total QuotationItems matching VIVO or MATT: ${vivoQuoItems.length}`);
  for (const i of vivoQuoItems) {
    console.log(`QuotationItem #${i.id} -> Quotation #${i.quotationId} (${i.quotation?.code}) Customer: "${i.quotation?.customerName}" | "${i.productName || i.product}" | design="${i.design}" | Created: ${i.createdAt?.toISOString()}`);
  }
}

main().finally(() => prisma.$disconnect());
