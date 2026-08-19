const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const bookings = await prisma.$queryRawUnsafe(`
    SELECT * FROM bookings WHERE customerName LIKE '%AMBIKA%'
  `);
  console.log(`Found ${bookings.length} Ambika bookings:`, bookings);
}

main().finally(() => prisma.$disconnect());
