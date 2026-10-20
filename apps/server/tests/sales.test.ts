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

describe('sales: checkout, stock deduction, holds and POS dashboards', () => {
  let fixtures: Fixtures;
  let cashierToken: string;
  let ownerToken: string;
  let clerkToken: string;

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    cashierToken = await tokenFor('CASHIER');
    ownerToken = await tokenFor('OWNER');
    clerkToken = await tokenFor('INVENTORY_CLERK');
  });

  afterAll(async () => {
    await disconnect();
  });

  it('completes a cash sale: deducts the batch, writes the ISSUE ledger and changes tendered cash', async () => {
    const product = await createProductFixture({ sku: 'SALE-1', salePrice: '9.50' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'L-SALE-1',
      expiryDate: isoDaysFromToday(300),
      quantity: 20,
    });

    const response = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({
        subtotal: '19.00',
        itemDiscount: '0.00',
        invoiceDiscount: '0.00',
        taxAmount: '2.85',
        total: '21.85',
        items: [
          { productId: product.id, batchId: batch.id, quantity: 2, unitPrice: '9.50', discount: '0.00' },
        ],
        payments: [{ method: 'cash', amount: '50.00' }],
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: 'completed',
      subtotal: '19.00',
      taxAmount: '2.85',
      total: '21.85',
      userId: expect.any(String),
      warehouseId: fixtures.warehouseId,
    });
    expect(response.body.invoiceNumber).toMatch(/^INV-\d{8}-\d{5}$/);

    // Over-tendered cash is capped at the invoice total; change is handed back.
    expect(response.body.payments).toHaveLength(1);
    expect(response.body.payments[0]).toMatchObject({ method: 'cash', amount: '21.85' });

    const updated = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updated.quantity).toBe(18);

    const movements = await prisma.stockMovement.findMany({
      where: { batchId: batch.id, type: 'ISSUE' },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.quantity).toBe(2);
    expect(movements[0]!.reference).toBe(response.body.invoiceNumber);
  });

  it('recomputes totals server-side so a tampered payload cannot shrink the invoice', async () => {
    const product = await createProductFixture({ sku: 'SALE-2', salePrice: '10.00' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'L-SALE-2',
      expiryDate: isoDaysFromToday(300),
      quantity: 10,
    });

    const response = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({
        subtotal: '0.01',
        taxAmount: '0.00',
        total: '0.01',
        items: [
          { productId: product.id, batchId: batch.id, quantity: 3, unitPrice: '10.00', discount: '0.00' },
        ],
        // A zero cash amount means "exact change"; the server still recomputes.
        payments: [{ method: 'cash', amount: '0.00' }],
      });

    expect(response.status).toBe(201);
    // 3 x 10.00 -> subtotal 30.00, VAT 15% -> 4.50, total 34.50.
    expect(response.body).toMatchObject({
      subtotal: '30.00',
      itemDiscount: '0.00',
      invoiceDiscount: '0.00',
      taxAmount: '4.50',
      total: '34.50',
    });
    // The submitted "payment" is topped up to the real total for a single cash line.
    expect(response.body.payments[0]).toMatchObject({ method: 'cash', amount: '34.50' });
  });

  it('rejects a checkout that cannot be fully paid', async () => {
    const product = await createProductFixture({ sku: 'SALE-3', salePrice: '20.00' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'L-SALE-3',
      expiryDate: isoDaysFromToday(300),
      quantity: 5,
    });

    const response = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({
        subtotal: '20.00',
        taxAmount: '3.00',
        total: '23.00',
        items: [
          { productId: product.id, batchId: batch.id, quantity: 1, unitPrice: '20.00', discount: '0.00' },
        ],
        payments: [{ method: 'card', amount: '10.00' }],
      });

    expect(response.status).toBe(400);

    const unchanged = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(unchanged.quantity).toBe(5);
  });

  it('fails with 409 and changes nothing when the batch cannot cover the quantity', async () => {
    const product = await createProductFixture({ sku: 'SALE-4', salePrice: '5.00' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'L-SALE-4',
      expiryDate: isoDaysFromToday(300),
      quantity: 2,
    });

    const response = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({
        subtotal: '50.00',
        taxAmount: '7.50',
        total: '57.50',
        items: [
          { productId: product.id, batchId: batch.id, quantity: 10, unitPrice: '5.00', discount: '0.00' },
        ],
        payments: [{ method: 'cash', amount: '57.50' }],
      });

    expect(response.status).toBe(409);

    const unchanged = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(unchanged.quantity).toBe(2);
    expect(await prisma.sale.count()).toBeGreaterThan(0);
    expect(
      await prisma.stockMovement.count({ where: { batchId: batch.id, type: 'ISSUE' } }),
    ).toBe(0);
  });

  it('suspends a hold without touching stock, lists it and resumes it', async () => {
    const product = await createProductFixture({ sku: 'HOLD-1', salePrice: '15.00' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'L-HOLD-1',
      expiryDate: isoDaysFromToday(300),
      quantity: 8,
    });

    const payload = {
      subtotal: '15.00',
      itemDiscount: '0.00',
      invoiceDiscount: '0.00',
      taxAmount: '2.25',
      total: '17.25',
      note: 'العميل راجع بعد قليل',
      items: [
        { productId: product.id, batchId: batch.id, quantity: 1, unitPrice: '15.00', discount: '0.00' },
      ],
    };

    const suspended = await request(testApp)
      .post('/api/v1/sales/suspend')
      .set(bearer(cashierToken))
      .send(payload);

    expect(suspended.status).toBe(201);
    expect(suspended.body).toMatchObject({ status: 'suspended', note: 'العميل راجع بعد قليل' });

    // Stock must be untouched while the sale is only a hold.
    const during = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(during.quantity).toBe(8);

    const list = await request(testApp)
      .get('/api/v1/sales/suspended')
      .set(bearer(cashierToken));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    const hold = list.body.find((sale: { id: string }) => sale.id === suspended.body.id);
    expect(hold).toBeDefined();
    expect(hold.items[0]).toMatchObject({ productId: product.id, batchId: batch.id, quantity: 1 });
    expect(hold.items[0].product).toMatchObject({ id: product.id });
    expect(hold.items[0].batch).toMatchObject({ id: batch.id, lotNumber: 'L-HOLD-1' });

    const resumed = await request(testApp)
      .post(`/api/v1/sales/${suspended.body.id}/resume`)
      .set(bearer(cashierToken));
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ status: 'suspended' });
  });

  it('voids a completed sale, restoring stock through a RETURN_IN movement', async () => {
    const product = await createProductFixture({ sku: 'VOID-1', salePrice: '8.00' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'L-VOID-1',
      expiryDate: isoDaysFromToday(300),
      quantity: 6,
    });

    const sale = await request(testApp)
      .post('/api/v1/sales')
      .set(bearer(cashierToken))
      .send({
        subtotal: '8.00',
        taxAmount: '1.20',
        total: '9.20',
        items: [
          { productId: product.id, batchId: batch.id, quantity: 1, unitPrice: '8.00', discount: '0.00' },
        ],
        payments: [{ method: 'cash', amount: '9.20' }],
      });
    expect(sale.status).toBe(201);

    const afterSale = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(afterSale.quantity).toBe(5);

    // Cashiers cannot void; refunds belong to OWNER/MANAGER/PHARMACIST.
    const forbidden = await request(testApp)
      .post(`/api/v1/sales/${sale.body.id}/void`)
      .set(bearer(cashierToken))
      .send({ reason: 'خطأ في الفاتورة' });
    expect(forbidden.status).toBe(403);

    const voided = await request(testApp)
      .post(`/api/v1/sales/${sale.body.id}/void`)
      .set(bearer(ownerToken))
      .send({ reason: 'خطأ في الفاتورة' });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ status: 'voided' });

    const afterVoid = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(afterVoid.quantity).toBe(6);
    expect(
      await prisma.stockMovement.count({ where: { batchId: batch.id, type: 'RETURN_IN' } }),
    ).toBe(1);
  });

  it('serves the best-sellers and recently-sold widgets', async () => {
    const product = await createProductFixture({ sku: 'TOP-1', nameAr: 'منتج الأكثر مبيعًا', salePrice: '12.00' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'L-TOP-1',
      expiryDate: isoDaysFromToday(300),
      quantity: 50,
    });

    const buy = (quantity: number, unitPrice: string, subtotal: string, taxAmount: string, total: string) =>
      request(testApp)
        .post('/api/v1/sales')
        .set(bearer(cashierToken))
        .send({
          subtotal,
          taxAmount,
          total,
          items: [
            { productId: product.id, batchId: batch.id, quantity, unitPrice, discount: '0.00' },
          ],
          payments: [{ method: 'cash', amount: '100.00' }],
        });

    // 2 x 12.00 -> 24.00 + 15% VAT 3.60 = 27.60
    expect((await buy(2, '12.00', '24.00', '3.60', '27.60')).status).toBe(201);
    // 1 x 12.00 -> 12.00 + 1.80 = 13.80
    expect((await buy(1, '12.00', '12.00', '1.80', '13.80')).status).toBe(201);

    const best = await request(testApp)
      .get('/api/v1/sales/best-sellers?period=week&limit=8&page=1')
      .set(bearer(cashierToken));
    expect(best.status).toBe(200);
    const top = best.body.items.find((item: { id: string }) => item.id === product.id);
    expect(top).toMatchObject({
      unitsSold: 3,
      invoicesCount: 2,
      revenue: '36.00',
      rank: expect.any(Number),
    });
    expect(best.body.total).toBeGreaterThanOrEqual(1);

    const recent = await request(testApp)
      .get('/api/v1/sales/recent?limit=10&period=7d')
      .set(bearer(cashierToken));
    expect(recent.status).toBe(200);
    const seen = recent.body.items.find((item: { id: string }) => item.id === product.id);
    expect(seen).toMatchObject({
      lastQuantity: expect.any(Number),
      lastInvoiceId: expect.any(String),
      lastSoldAt: expect.any(String),
    });
  });

  it('lists invoices for the cashier but denies the inventory clerk', async () => {
    const allowed = await request(testApp).get('/api/v1/sales?page=1&pageSize=5').set(bearer(cashierToken));
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ page: 1, pageSize: 5 });
    expect(Array.isArray(allowed.body.items)).toBe(true);

    const denied = await request(testApp).get('/api/v1/sales').set(bearer(clerkToken));
    expect(denied.status).toBe(403);
  });
});
