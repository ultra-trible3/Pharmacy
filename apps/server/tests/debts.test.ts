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

/** ISO date `days` from today (UTC). Big margins keep timezone edges irrelevant. */
function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('debts: credit sales, receivables and collections', () => {
  let fixtures: Fixtures;
  let cashierToken: string;
  let ownerToken: string;
  let accountantToken: string;
  let clerkToken: string;

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    cashierToken = await tokenFor('CASHIER');
    ownerToken = await tokenFor('OWNER');
    accountantToken = await tokenFor('ACCOUNTANT');
    clerkToken = await tokenFor('INVENTORY_CLERK');
  });

  afterAll(async () => {
    await disconnect();
  });

  /** Product + batch for a checkout: 2 x 10.00 -> subtotal 20.00, VAT 3.00, total 23.00. */
  async function stockedProduct(sku: string, quantity = 20) {
    const product = await createProductFixture({ sku, salePrice: '10.00' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: `L-${sku}`,
      expiryDate: isoDaysFromToday(300),
      quantity,
    });
    return { product, batch };
  }

  function creditSalePayload(
    productId: string,
    batchId: string,
    method: 'credit' | 'cash' = 'credit',
  ) {
    return {
      subtotal: '20.00',
      itemDiscount: '0.00',
      invoiceDiscount: '0.00',
      taxAmount: '3.00',
      total: '23.00',
      items: [
        { productId, batchId, quantity: 2, unitPrice: '10.00', discount: '0.00' },
      ],
      payments: [{ method, amount: '23.00' }],
    };
  }

  it('grows the balance on a credit sale, then collections shrink it down to zero', async () => {
    const customer = await prisma.customer.create({
      data: { name: 'حسن الآجل', phone: '01011112222', creditLimit: '1000.00' },
    });
    const { product, batch } = await stockedProduct('DEBT-1');

    const sale = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({ ...creditSalePayload(product.id, batch.id), customerId: customer.id });
    expect(sale.status).toBe(201);
    expect(sale.body.payments[0]).toMatchObject({ method: 'credit', amount: '23.00' });

    const afterSale = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(Number(afterSale.currentBalance)).toBe(23);

    // The receivables list surfaces the debtor with a summary.
    const list = await request(testApp)
      .get('/api/v1/debts?page=1&pageSize=25')
      .set(bearer(cashierToken));
    expect(list.status).toBe(200);
    const row = list.body.items.find((item: { id: string }) => item.id === customer.id);
    expect(row).toMatchObject({
      name: 'حسن الآجل',
      currentBalance: '23.00',
      creditLimit: '1000.00',
      isOverLimit: false,
      availableCredit: '977.00',
    });
    expect(list.body.summary).toMatchObject({
      totalOutstanding: expect.any(String),
      debtorsTotal: expect.any(Number),
      overLimitCount: expect.any(Number),
    });

    // Statement shows the credit invoice.
    const ledger = await request(testApp)
      .get(`/api/v1/debts/${customer.id}`)
      .set(bearer(cashierToken));
    expect(ledger.status).toBe(200);
    expect(ledger.body.customer).toMatchObject({ id: customer.id, currentBalance: '23.00' });
    expect(ledger.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'sale',
          amount: '23.00',
          invoiceNumber: sale.body.invoiceNumber,
        }),
      ]),
    );

    // Partial collection.
    const partial = await request(testApp)
      .post(`/api/v1/debts/${customer.id}/payments`)
      .set(bearer(cashierToken))
      .send({ amount: '10.00', method: 'cash' });
    expect(partial.status).toBe(201);
    expect(partial.body.customer).toMatchObject({ currentBalance: '13.00' });
    expect(partial.body.payment).toMatchObject({ amount: '10.00', method: 'cash' });

    // Over-collection is rejected.
    const tooMuch = await request(testApp)
      .post(`/api/v1/debts/${customer.id}/payments`)
      .set(bearer(cashierToken))
      .send({ amount: '50.00', method: 'cash' });
    expect(tooMuch.status).toBe(400);

    // Card payments require a reference.
    const missingRef = await request(testApp)
      .post(`/api/v1/debts/${customer.id}/payments`)
      .set(bearer(cashierToken))
      .send({ amount: '13.00', method: 'card' });
    expect(missingRef.status).toBe(400);

    // Settle the rest.
    const settled = await request(testApp)
      .post(`/api/v1/debts/${customer.id}/payments`)
      .set(bearer(cashierToken))
      .send({ amount: '13.00', method: 'cash' });
    expect(settled.status).toBe(201);
    expect(settled.body.customer).toMatchObject({ currentBalance: '0.00' });

    // Fully paid customers leave the receivables list and reject further payments.
    const after = await request(testApp)
      .get(`/api/v1/debts?q=${encodeURIComponent('حسن الآجل')}`)
      .set(bearer(cashierToken));
    expect(after.body.items).toHaveLength(0);

    const extra = await request(testApp)
      .post(`/api/v1/debts/${customer.id}/payments`)
      .set(bearer(cashierToken))
      .send({ amount: '1.00', method: 'cash' });
    expect(extra.status).toBe(400);

    // The statement now shows both collections and the invoice.
    const ledgerAfter = await request(testApp)
      .get(`/api/v1/debts/${customer.id}`)
      .set(bearer(cashierToken));
    expect(ledgerAfter.body.entries.filter((e: { type: string }) => e.type === 'payment')).toHaveLength(2);
  });

  it('rejects credit checkouts that exceed the credit limit or hit a customer without one', async () => {
    const limited = await prisma.customer.create({
      data: { name: 'عميل بحد ضيق', phone: '01033334444', creditLimit: '10.00' },
    });
    const { product, batch } = await stockedProduct('DEBT-2');

    const overLimit = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({ ...creditSalePayload(product.id, batch.id), customerId: limited.id });
    expect(overLimit.status).toBe(400);
    expect(overLimit.body.error.message).toContain('حد الائتمان');

    const noLimit = await prisma.customer.create({ data: { name: 'بدون حد ائتمان' } });
    const noCredit = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({ ...creditSalePayload(product.id, batch.id), customerId: noLimit.id });
    expect(noCredit.status).toBe(400);

    // Nothing was deducted and no balance moved.
    const untouched = await prisma.customer.findUniqueOrThrow({ where: { id: limited.id } });
    expect(Number(untouched.currentBalance)).toBe(0);
    const batchRow = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchRow.quantity).toBe(20);

    // A cash sale on the same customer is unaffected by the limit.
    const cashSale = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({ ...creditSalePayload(product.id, batch.id, 'cash'), customerId: limited.id });
    expect(cashSale.status).toBe(201);
    const stillZero = await prisma.customer.findUniqueOrThrow({ where: { id: limited.id } });
    expect(Number(stillZero.currentBalance)).toBe(0);
  });

  it('reverses the debt when a credit invoice is voided', async () => {
    const customer = await prisma.customer.create({
      data: { name: 'عميل إلغاء', phone: '01055556666', creditLimit: '500.00' },
    });
    const { product, batch } = await stockedProduct('DEBT-3');

    const sale = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({ ...creditSalePayload(product.id, batch.id), customerId: customer.id });
    expect(sale.status).toBe(201);

    const owed = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(Number(owed.currentBalance)).toBe(23);

    const voided = await request(testApp)
      .post(`/api/v1/sales/${sale.body.id}/void`)
      .set(bearer(ownerToken))
      .send({ reason: 'عميل غيّر رأيه' });
    expect(voided.status).toBe(200);

    const cleared = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(Number(cleared.currentBalance)).toBe(0);

    // The voided invoice leaves the statement.
    const ledger = await request(testApp)
      .get(`/api/v1/debts/${customer.id}`)
      .set(bearer(cashierToken));
    expect(ledger.body.entries.filter((e: { type: string }) => e.type === 'sale')).toHaveLength(0);
  });

  it('lets accountants read the ledger but only sales roles collect payments', async () => {
    const allowed = await request(testApp).get('/api/v1/debts').set(bearer(accountantToken));
    expect(allowed.status).toBe(200);

    const denied = await request(testApp).get('/api/v1/debts').set(bearer(clerkToken));
    expect(denied.status).toBe(403);

    const customer = await prisma.customer.create({
      data: { name: 'عميل صلاحيات', currentBalance: '30.00', creditLimit: '200.00' },
    });

    const deniedPayment = await request(testApp)
      .post(`/api/v1/debts/${customer.id}/payments`)
      .set(bearer(accountantToken))
      .send({ amount: '10.00', method: 'cash' });
    expect(deniedPayment.status).toBe(403);

    const missing = await request(testApp)
      .get('/api/v1/debts/prc_missing')
      .set(bearer(cashierToken));
    expect(missing.status).toBe(404);
  });
});
