// Read-only audit of application code using a disposable database and fake parties.
// Runs the actual HTTP validation pipe and OrdersService; never opens dev.db.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(root, 'tmp-order-validation-audit-'));
const db = path.join(dir, 'audit.db');
process.env.DATABASE_URL = `file:${db.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { ValidationPipe } = require('@nestjs/common');
const { CreateOrderDto, UpdateOrderDto } = require('../apps/api/src/orders/dto/order.dto.ts');
const { OrdersService } = require('../apps/api/src/orders/orders.service.ts');
const { BookingsService } = require('../apps/api/src/bookings/bookings.service.ts');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const bookings = new BookingsService(prisma, {});
const orders = new OrdersService(prisma, {}, bookings, { orderCreated() {}, orderUpdated() {} });
const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: false } });
const validate = (input, metatype = CreateOrderDto) => pipe.transform(input, { type: 'body', metatype });
const item = (extra = {}) => ({ product: 'AUDIT GLASS', productName: '7 AUDIT GLASS', psize: 7,
  pCategory: 'GLASS', subCategory: 'PLAIN', design: 'NA', designType: null,
  productRate: 100, designRate: 0, rate: 100, gram: 70, bags: 1, pcs: 12, box: 1,
  calField: 'KGS', priority: 'NORMAL', ordType: 'SALES ORDER', ...extra });
const input = (items = [item()], extra = {}) => ({ customerName: 'AUDIT PARTY',
  orderDate: '2026-09-19', completionDate: '2026-09-26', status: 'CONFIRMED', items, ...extra });
const results = [];
async function probe(name, action) {
  try { results.push({ name, result: 'ACCEPTED', evidence: await action() }); }
  catch (e) { results.push({ name, result: 'REJECTED', status: e.getStatus?.() ?? null,
    message: e.getResponse?.() ?? e.message.split('\n').filter(Boolean).at(-1) }); }
}
async function save(items, extra) {
  const dto = await validate(input(items, extra));
  const saved = await orders.create(dto);
  return { customerName: saved.customerName, customerId: saved.customerId, status: saved.status,
    orderDate: saved.orderDate, completionDate: saved.completionDate, completionDay: saved.completionDay,
    totalAmount: saved.totalAmount, items: saved.items.map(({ id, product, pCategory, design, productRate,
      designRate, rate, bags, pcs, gram, calField, priority, ordType }) => ({ id, product, pCategory,
      design, productRate, designRate, rate, bags, pcs, gram, calField, priority, ordType })) };
}
(async () => {
  try {
    const schema = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff',
      '--from-empty', '--to-schema-datamodel', path.join(root, 'apps/api/prisma/schema.prisma'), '--script'],
      { cwd: root, encoding: 'utf8', env: process.env });
    if (schema.status !== 0) throw new Error(schema.stderr);
    const sqlite = new DatabaseSync(db); sqlite.exec(schema.stdout); sqlite.close();
    await prisma.customer.create({ data: { partyName: 'AUDIT PARTY', agentName: 'SELF', active: true } });
    await prisma.product.create({ data: { category: 'GLASS', subCategory: 'PLAIN', product: 'AUDIT GLASS', size: 7, rate: 100 } });
    await probe('Control: valid confirmed order', () => save());
    await probe('Confirmed order with no items', () => save([]));
    await probe('Confirmed order with empty item object', () => save([{}]));
    await probe('Unknown customer', () => save(undefined, { customerName: 'UNKNOWN AUDIT PARTY' }));
    await probe('Whitespace customer', () => save(undefined, { customerName: '   ' }));
    await probe('Negative ordinary quantities', () => save([item({ bags: -1, gram: -70, pcs: -12 })]));
    await probe('Zero billing quantity', () => save([item({ gram: 0 })]));
    await probe('Non-numeric billing quantity', () => save([item({ gram: 'mistyped' })]));
    await probe('Missing product rate', () => save([item({ productRate: null, rate: 0 })]));
    await probe('Negative product rate', () => save([item({ productRate: -100, rate: -100 })]));
    await probe('Total differs from product plus design', () => save([item({ productRate: 100, designRate: 20, rate: 1 })]));
    await probe('Unknown product and design', () => save([item({ product: 'MISSING PRODUCT', design: 'MISSING DESIGN' })]));
    await probe('Missing priority, order type and billing unit', () => save([item({ priority: null, ordType: null, calField: null })]));
    await probe('Confirmed order without completion date', () => save(undefined, { completionDate: undefined }));
    await probe('Completion date before order date', () => save(undefined, { completionDate: '2026-09-01' }));
    await probe('Malformed order date', () => save(undefined, { orderDate: 'not-a-date' }));
    await probe('Unknown order status', () => save(undefined, { status: 'NOT_A_STATUS' }));
    await probe('Partial header edit', async () => {
      const saved = await orders.create(await validate(input()));
      const edited = await orders.update(saved.id, await validate({ comment: 'Only this should change' }, UpdateOrderDto));
      return { before: { customerName: saved.customerName, orderDate: saved.orderDate, completionDate: saved.completionDate, status: saved.status },
        after: { customerName: edited.customerName, orderDate: edited.orderDate, completionDate: edited.completionDate, status: edited.status } };
    });
    const dispatched = async () => {
      const saved = await orders.create(await validate(input()));
      await prisma.dispatch.create({ data: { orderId: saved.id, orderItemId: saved.items[0].id,
        customerName: 'AUDIT PARTY', bags: 0.5, gram: 35, rate: 100 } });
      return saved;
    };
    await probe('Control: dedicated status route rejects cancelling shipped order', async () => {
      const saved = await dispatched(); return orders.updateStatus(saved.id, 'CANCELLED');
    });
    await probe('General edit route cancels shipped order', async () => {
      const saved = await dispatched();
      const edited = await orders.update(saved.id, await validate(input(saved.items, { status: 'CANCELLED' }), UpdateOrderDto));
      return { status: edited.status, dispatches: await prisma.dispatch.count({ where: { orderId: saved.id } }) };
    });
    await probe('Shipped line design name and category change', async () => {
      const saved = await dispatched();
      const edited = await orders.update(saved.id, await validate(input([{ ...saved.items[0], design: 'DIFFERENT DESIGN', pCategory: 'CUP' }]), UpdateOrderDto));
      return { design: edited.items[0].design, category: edited.items[0].pCategory };
    });
    await probe('Shipped order deletion', async () => {
      const saved = await dispatched(); await orders.remove(saved.id);
      return { remainingDispatches: await prisma.dispatch.count({ where: { orderId: saved.id } }) };
    });
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await prisma.$disconnect();
    if (path.dirname(path.resolve(dir)) !== root || !path.basename(dir).startsWith('tmp-order-validation-audit-')) throw new Error('Unexpected cleanup path');
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
