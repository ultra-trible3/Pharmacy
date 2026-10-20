import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import {
  bearer,
  createBatchFixture,
  createProductFixture,
  disconnect,
  resetDatabase,
  seedFixtures,
  testApp,
  tokenFor,
  type Fixtures,
} from './helpers.js';

function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

let warehouseSequence = 0;
async function createWarehouse(label: string): Promise<string> {
  warehouseSequence += 1;
  const warehouse = await prisma.warehouse.create({
    data: {
      code: `SHIFT-${label}-${warehouseSequence}`,
      nameAr: `مخزن ${label}`,
      isActive: true,
    },
    select: { id: true },
  });
  return warehouse.id;
}

function openShift(
  token: string,
  body: { warehouseId: string; openingBalance?: string; notes?: string },
  terminalId?: string,
) {
  const call = request(testApp).post('/api/v1/cashdrawer/open').set(bearer(token));
  if (terminalId) call.set('x-terminal-id', terminalId);
  return call.send(body);
}

function closeShift(token: string, id: string, closingBalance: string, notes?: string) {
  return request(testApp)
    .patch(`/api/v1/cashdrawer/${id}/close`)
    .set(bearer(token))
    .send({ closingBalance, ...(notes ? { notes } : {}) });
}

function getDetail(token: string, id: string) {
  return request(testApp).get(`/api/v1/cashdrawer/${id}`).set(bearer(token));
}

async function createStock(warehouseId: string, sku: string, quantity = 50) {
  const product = await createProductFixture({ sku, salePrice: '10.00' });
  const batch = await createBatchFixture({
    productId: product.id,
    warehouseId,
    lotNumber: `LOT-${sku}`,
    expiryDate: isoDaysFromToday(365),
    quantity,
  });
  return { product, batch };
}

function createSale(
  token: string,
  params: {
    warehouseId: string;
    productId: string;
    batchId: string;
    payments: Array<{ method: string; amount: string; reference?: string }>;
    customerId?: string;
  },
) {
  return request(testApp)
    .post('/api/v1/sales')
    .set(bearer(token))
    .send({
      ...(params.customerId ? { customerId: params.customerId } : {}),
      warehouseId: params.warehouseId,
      subtotal: '10.00',
      itemDiscount: '0.00',
      invoiceDiscount: '0.00',
      taxAmount: '1.50',
      total: '11.50',
      items: [
        {
          productId: params.productId,
          batchId: params.batchId,
          quantity: 1,
          unitPrice: '10.00',
          discount: '0.00',
        },
      ],
      payments: params.payments,
    });
}

function voidSale(token: string, id: string, reason = 'إرجاع العميل') {
  return request(testApp)
    .post(`/api/v1/sales/${id}/void`)
    .set(bearer(token))
    .send({ reason });
}

describe('cash drawer: shift reconciliation', () => {
  let fixtures: Fixtures;
  let cashierToken: string;
  let pharmacistToken: string;
  let ownerToken: string;
  let clerkToken: string;
  let accountantToken: string;

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    cashierToken = await tokenFor('CASHIER');
    pharmacistToken = await tokenFor('PHARMACIST');
    ownerToken = await tokenFor('OWNER');
    clerkToken = await tokenFor('INVENTORY_CLERK');
    accountantToken = await tokenFor('ACCOUNTANT');
  });

  afterAll(async () => {
    await disconnect();
  });

  it('opens a shift with opening cash, cashier, warehouse and terminal, and rejects duplicates', async () => {
    const warehouseId = await createWarehouse('A');
    const otherWarehouseId = await createWarehouse('A2');

    const response = await openShift(
      cashierToken,
      { warehouseId, openingBalance: '100.00', notes: 'وردية الصباح' },
      'TERM-A',
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      warehouseId,
      warehouseNameAr: 'مخزن A',
      terminalId: 'TERM-A',
      openingBalance: '100.00',
      expectedBalance: '100.00',
      closingBalance: null,
      variance: null,
      status: 'OPEN',
      notes: 'وردية الصباح',
      userName: 'مستخدم CASHIER',
    });
    expect(response.body.openedAt).toEqual(expect.any(String));

    const duplicate = await openShift(cashierToken, { warehouseId, openingBalance: '0.00' });
    expect(duplicate.status).toBe(409);

    // Same terminal may not host a second open shift even in another warehouse.
    const terminalTaken = await openShift(
      cashierToken,
      { warehouseId: otherWarehouseId, openingBalance: '0.00' },
      'TERM-A',
    );
    expect(terminalTaken.status).toBe(409);

    const close = await closeShift(cashierToken, response.body.id, '100.00');
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('CLOSED');
  });

  it('closes a no-sales shift with opening cash as expected cash and exact variance', async () => {
    const warehouseId = await createWarehouse('B');
    const opened = await openShift(cashierToken, { warehouseId, openingBalance: '50.00' });
    expect(opened.status).toBe(201);
    const shiftId = opened.body.id as string;

    const live = await getDetail(cashierToken, shiftId);
    expect(live.status).toBe(200);
    expect(live.body.reconciliation).toMatchObject({
      openingBalance: '50.00',
      cashSales: '0.00',
      totalSales: '0.00',
      expectedCash: '50.00',
      countedCash: null,
      variance: null,
      salesCount: 0,
      transactionCount: 0,
      status: 'OPEN',
    });
    expect(live.body.movements).toEqual([]);
    expect(live.body.recentSales).toEqual([]);

    const closed = await closeShift(cashierToken, shiftId, '50.00');
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      expectedBalance: '50.00',
      closingBalance: '50.00',
      variance: '0.00',
      closedByName: 'مستخدم CASHIER',
    });
    expect(closed.body.closedAt).toEqual(expect.any(String));
    expect(closed.body.reconciliation).toMatchObject({
      expectedCash: '50.00',
      countedCash: '50.00',
      variance: '0.00',
      status: 'CLOSED',
    });

    // The snapshot is stable and a repeated close is rejected.
    const again = await closeShift(cashierToken, shiftId, '999.00');
    expect(again.status).toBe(409);
    const snapshot = await getDetail(cashierToken, shiftId);
    expect(snapshot.body.reconciliation.countedCash).toBe('50.00');

    // No cash movements may be added to a closed shift.
    const movement = await request(testApp)
      .post(`/api/v1/cashdrawer/${shiftId}/movements`)
      .set(bearer(cashierToken))
      .send({ type: 'paid_out', amount: '5.00', reason: 'بعد الإغلاق' });
    expect(movement.status).toBe(409);
  });

  it('aggregates mixed payment methods and keeps non-cash out of drawer cash', async () => {
    const warehouseId = await createWarehouse('C');
    const { product, batch } = await createStock(warehouseId, 'SHIFT-C');
    const customer = await prisma.customer.create({
      data: { name: 'عميل آجل', creditLimit: '500.00', currentBalance: '0.00' },
    });

    const opened = await openShift(cashierToken, { warehouseId, openingBalance: '100.00' });
    const shiftId = opened.body.id as string;

    const mixed = await createSale(cashierToken, {
      warehouseId,
      productId: product.id,
      batchId: batch.id,
      payments: [
        { method: 'cash', amount: '5.00' },
        { method: 'card', amount: '3.00', reference: 'CARD-1' },
        { method: 'wallet', amount: '3.50', reference: 'WALLET-1' },
      ],
    });
    expect(mixed.status).toBe(201);
    expect(mixed.body.total).toBe('11.50');

    const credit = await createSale(cashierToken, {
      warehouseId,
      productId: product.id,
      batchId: batch.id,
      customerId: customer.id,
      payments: [{ method: 'credit', amount: '11.50' }],
    });
    expect(credit.status).toBe(201);

    const detail = await getDetail(cashierToken, shiftId);
    expect(detail.body.reconciliation).toMatchObject({
      cashSales: '5.00',
      cardSales: '3.00',
      walletSales: '3.50',
      creditSales: '11.50',
      totalSales: '23.00',
      expectedCash: '105.00',
      salesCount: 2,
      transactionCount: 2,
    });

    const closed = await closeShift(cashierToken, shiftId, '105.00');
    expect(closed.status).toBe(200);
    expect(closed.body.variance).toBe('0.00');
    expect(closed.body.reconciliation.cardSales).toBe('3.00');
  });

  it('records a same-shift void as a cash refund so the drawer nets to zero', async () => {
    const warehouseId = await createWarehouse('D');
    const { product, batch } = await createStock(warehouseId, 'SHIFT-D');
    const opened = await openShift(pharmacistToken, { warehouseId, openingBalance: '100.00' });
    const shiftId = opened.body.id as string;

    const sale = await createSale(pharmacistToken, {
      warehouseId,
      productId: product.id,
      batchId: batch.id,
      payments: [{ method: 'cash', amount: '20.00' }],
    });
    expect(sale.status).toBe(201);

    const voided = await voidSale(pharmacistToken, sale.body.id);
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('voided');

    const detail = await getDetail(pharmacistToken, shiftId);
    expect(detail.body.reconciliation).toMatchObject({
      cashSales: '11.50',
      cashRefunds: '11.50',
      expectedCash: '100.00',
      salesCount: 0,
      voidedSalesCount: 1,
      refundsCount: 1,
    });

    const refund = await prisma.refund.findFirstOrThrow({ where: { saleId: sale.body.id } });
    expect(refund.shiftId).toBe(shiftId);
    expect(refund.method).toBe('CASH');
    expect(refund.amount.toString()).toBe('11.5');

    const closed = await closeShift(pharmacistToken, shiftId, '100.00');
    expect(closed.status).toBe(200);
    expect(closed.body.variance).toBe('0.00');

    // A second void request cannot create a second refund.
    const repeat = await voidSale(pharmacistToken, sale.body.id);
    expect(repeat.status).toBe(400);
    expect(await prisma.refund.count({ where: { saleId: sale.body.id } })).toBe(1);
  });

  it('attributes a refund to the current shift and keeps the closed shift snapshot immutable', async () => {
    const warehouseId = await createWarehouse('E');
    const { product, batch } = await createStock(warehouseId, 'SHIFT-E');

    const first = await openShift(pharmacistToken, { warehouseId, openingBalance: '0.00' });
    const firstId = first.body.id as string;
    const sale = await createSale(pharmacistToken, {
      warehouseId,
      productId: product.id,
      batchId: batch.id,
      payments: [{ method: 'cash', amount: '11.50' }],
    });
    expect(sale.status).toBe(201);

    const firstClose = await closeShift(pharmacistToken, firstId, '11.50');
    expect(firstClose.status).toBe(200);
    expect(firstClose.body.reconciliation).toMatchObject({
      cashSales: '11.50',
      cashRefunds: '0.00',
      expectedCash: '11.50',
      variance: '0.00',
    });

    const second = await openShift(pharmacistToken, { warehouseId, openingBalance: '0.00' });
    const secondId = second.body.id as string;

    const voided = await voidSale(pharmacistToken, sale.body.id);
    expect(voided.status).toBe(200);

    const secondDetail = await getDetail(pharmacistToken, secondId);
    expect(secondDetail.body.reconciliation).toMatchObject({
      cashSales: '0.00',
      cashRefunds: '11.50',
      expectedCash: '-11.50',
      refundsCount: 1,
    });

    const firstSnapshot = await getDetail(pharmacistToken, firstId);
    expect(firstSnapshot.body.reconciliation).toMatchObject({
      cashSales: '11.50',
      cashRefunds: '0.00',
      expectedCash: '11.50',
      countedCash: '11.50',
      variance: '0.00',
    });

    const secondClose = await closeShift(pharmacistToken, secondId, '0.00');
    expect(secondClose.status).toBe(200);
    expect(secondClose.body.variance).toBe('11.50');

    const firstAfter = await getDetail(pharmacistToken, firstId);
    expect(firstAfter.body.reconciliation).toEqual(firstSnapshot.body.reconciliation);
  });

  it('includes recorded expenses and explicit paid-in / paid-out movements', async () => {
    const warehouseId = await createWarehouse('F');
    const opened = await openShift(ownerToken, { warehouseId, openingBalance: '100.00' });
    const shiftId = opened.body.id as string;

    const expense = await request(testApp)
      .post('/api/v1/expenses')
      .set(bearer(ownerToken))
      .send({
        category: 'OTHER',
        descriptionAr: 'مصروف نقدي من الدرج',
        amount: '20.00',
        paidAt: isoDaysFromToday(0),
        warehouseId,
      });
    expect(expense.status).toBe(201);
    expect(
      await prisma.expense.findUniqueOrThrow({ where: { id: expense.body.id } }).then((row) => row.shiftId),
    ).toBe(shiftId);

    const paidIn = await request(testApp)
      .post(`/api/v1/cashdrawer/${shiftId}/movements`)
      .set(bearer(ownerToken))
      .send({ type: 'paid_in', amount: '10.00', reason: 'إيداع نقدي' });
    expect(paidIn.status).toBe(201);

    const paidOut = await request(testApp)
      .post(`/api/v1/cashdrawer/${shiftId}/movements`)
      .set(bearer(ownerToken))
      .send({ type: 'paid_out', amount: '5.50', reason: 'سحب نقدي' });
    expect(paidOut.status).toBe(201);

    const invalidAmount = await request(testApp)
      .post(`/api/v1/cashdrawer/${shiftId}/movements`)
      .set(bearer(ownerToken))
      .send({ type: 'paid_in', amount: '0.00', reason: 'قيمة صفرية' });
    expect(invalidAmount.status).toBe(400);

    const detail = await getDetail(ownerToken, shiftId);
    expect(detail.body.reconciliation).toMatchObject({
      expensesTotal: '20.00',
      expensesCount: 1,
      paidInTotal: '10.00',
      paidOutTotal: '5.50',
      paidInCount: 1,
      paidOutCount: 1,
      expectedCash: '84.50',
    });
    expect(detail.body.movements).toHaveLength(2);

    const closed = await closeShift(ownerToken, shiftId, '84.50');
    expect(closed.status).toBe(200);
    expect(closed.body.variance).toBe('0.00');
    expect(closed.body.reconciliation.expensesTotal).toBe('20.00');
  });

  it('treats cash debt collections as drawer inflows and excludes card collections', async () => {
    const warehouseId = await createWarehouse('G');
    const customer = await prisma.customer.create({
      data: { name: 'مدين', creditLimit: '500.00', currentBalance: '80.00' },
    });
    const opened = await openShift(cashierToken, { warehouseId, openingBalance: '0.00' });
    const shiftId = opened.body.id as string;

    const cashPayment = await request(testApp)
      .post(`/api/v1/debts/${customer.id}/payments`)
      .set(bearer(cashierToken))
      .send({ amount: '50.00', method: 'cash' });
    expect(cashPayment.status).toBe(201);

    const cardPayment = await request(testApp)
      .post(`/api/v1/debts/${customer.id}/payments`)
      .set(bearer(cashierToken))
      .send({ amount: '20.00', method: 'card', reference: 'POS-REF' });
    expect(cardPayment.status).toBe(201);

    const detail = await getDetail(cashierToken, shiftId);
    expect(detail.body.reconciliation).toMatchObject({
      customerCashTotal: '50.00',
      customerPaymentsCount: 2,
      expectedCash: '50.00',
    });

    const closed = await closeShift(cashierToken, shiftId, '50.00');
    expect(closed.status).toBe(200);
    expect(closed.body.variance).toBe('0.00');
  });

  it('persists shortages and overages without changing the counted cash', async () => {
    const shortageWarehouse = await createWarehouse('H');
    const shortage = await openShift(cashierToken, {
      warehouseId: shortageWarehouse,
      openingBalance: '100.00',
    });
    const shortageClose = await closeShift(cashierToken, shortage.body.id, '90.00');
    expect(shortageClose.status).toBe(200);
    expect(shortageClose.body).toMatchObject({
      expectedBalance: '100.00',
      closingBalance: '90.00',
      variance: '-10.00',
    });

    const overageWarehouse = await createWarehouse('I');
    const overage = await openShift(cashierToken, {
      warehouseId: overageWarehouse,
      openingBalance: '100.00',
    });
    const overageClose = await closeShift(cashierToken, overage.body.id, '110.00');
    expect(overageClose.status).toBe(200);
    expect(overageClose.body).toMatchObject({
      expectedBalance: '100.00',
      closingBalance: '110.00',
      variance: '10.00',
    });

    const pennyWarehouse = await createWarehouse('J');
    const penny = await openShift(cashierToken, { warehouseId: pennyWarehouse, openingBalance: '0.00' });
    const pennyClose = await closeShift(cashierToken, penny.body.id, '0.01');
    expect(pennyClose.body.variance).toBe('0.01');
    expect(pennyClose.body.closingBalance).toBe('0.01');
  });

  it('never assigns historical sales without a shift to a later shift', async () => {
    const warehouseId = await createWarehouse('K');
    const { product, batch } = await createStock(warehouseId, 'SHIFT-K');

    // No shift is open yet: the sale must stay unlinked.
    const sale = await createSale(cashierToken, {
      warehouseId,
      productId: product.id,
      batchId: batch.id,
      payments: [{ method: 'cash', amount: '11.50' }],
    });
    expect(sale.status).toBe(201);
    expect(
      await prisma.sale.findUniqueOrThrow({ where: { id: sale.body.id } }).then((row) => row.shiftId),
    ).toBeNull();

    const opened = await openShift(cashierToken, { warehouseId, openingBalance: '0.00' });
    const close = await closeShift(cashierToken, opened.body.id, '0.00');
    expect(close.status).toBe(200);
    expect(close.body.reconciliation).toMatchObject({
      salesCount: 0,
      cashSales: '0.00',
      expectedCash: '0.00',
    });

    expect(
      await prisma.sale.findUniqueOrThrow({ where: { id: sale.body.id } }).then((row) => row.shiftId),
    ).toBeNull();
  });

  it('enforces cash drawer permissions on every endpoint', async () => {
    const warehouseId = await createWarehouse('L');

    const clerkOpen = await openShift(clerkToken, { warehouseId, openingBalance: '0.00' });
    expect(clerkOpen.status).toBe(403);
    const accountantOpen = await openShift(accountantToken, { warehouseId, openingBalance: '0.00' });
    expect(accountantOpen.status).toBe(403);

    const clerkList = await request(testApp).get('/api/v1/cashdrawer').set(bearer(clerkToken));
    expect(clerkList.status).toBe(403);
    const accountantList = await request(testApp)
      .get('/api/v1/cashdrawer')
      .set(bearer(accountantToken));
    expect(accountantList.status).toBe(403);

    const anonymous = await request(testApp).get('/api/v1/cashdrawer');
    expect(anonymous.status).toBe(401);

    // A cashier may read the list but cannot add movements to another shift.
    const opened = await openShift(cashierToken, { warehouseId, openingBalance: '0.00' });
    expect(opened.status).toBe(201);
    const shiftId = opened.body.id as string;
    const clerkMovement = await request(testApp)
      .post(`/api/v1/cashdrawer/${shiftId}/movements`)
      .set(bearer(clerkToken))
      .send({ type: 'paid_in', amount: '1.00', reason: 'غير مصرح' });
    expect(clerkMovement.status).toBe(403);
    const clerkClose = await closeShift(clerkToken, shiftId, '0.00');
    expect(clerkClose.status).toBe(403);

    const cashierList = await request(testApp).get('/api/v1/cashdrawer').set(bearer(cashierToken));
    expect(cashierList.status).toBe(200);

    const close = await closeShift(cashierToken, shiftId, '0.00');
    expect(close.status).toBe(200);
  });

  it('allows exactly one winner when two close requests race', async () => {
    const warehouseId = await createWarehouse('M');
    const opened = await openShift(cashierToken, { warehouseId, openingBalance: '100.00' });
    const shiftId = opened.body.id as string;

    const results = await Promise.all([
      closeShift(cashierToken, shiftId, '100.00'),
      closeShift(cashierToken, shiftId, '90.00'),
    ]);
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 409]);

    const winner = results.find((result) => result.status === 200)!;
    const persisted = await prisma.cashDrawer.findUniqueOrThrow({ where: { id: shiftId } });
    expect(persisted.status).toBe('CLOSED');
    expect(Number(persisted.closingBalance)).toBe(Number(winner.body.closingBalance));
    expect(Number(persisted.variance)).toBe(Number(winner.body.variance));

    const audits = await prisma.auditLog.count({
      where: { action: 'cashdrawer.closed', entityId: shiftId },
    });
    expect(audits).toBe(1);

    const third = await closeShift(cashierToken, shiftId, '100.00');
    expect(third.status).toBe(409);
  });

  it('returns 404 for an unknown shift and for unknown movement targets', async () => {
    const detail = await getDetail(cashierToken, 'does-not-exist');
    expect(detail.status).toBe(404);

    const movement = await request(testApp)
      .post('/api/v1/cashdrawer/does-not-exist/movements')
      .set(bearer(cashierToken))
      .send({ type: 'paid_in', amount: '1.00', reason: 'غير موجود' });
    expect(movement.status).toBe(404);
  });
});
