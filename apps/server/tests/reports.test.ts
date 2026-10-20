import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import { businessDayStart, todayInBusinessTimezone } from '../src/lib/dates.js';
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

function plusDays(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

interface SaleItemInput {
  productId: string;
  quantity: number;
  unitPrice: string;
}

/** Creates a completed sale through the real checkout endpoint. */
async function createSale(
  token: string,
  items: SaleItemInput[],
  payments: Array<{ method: 'cash' | 'card'; amount: string }>,
): Promise<{ id: string; invoiceNumber: string; total: string }> {
  const subtotal = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
  const tax = Math.round(subtotal * 0.15 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  const response = await request(testApp)
    .post('/api/v1/sales')
    .set(bearer(token))
    .send({
      subtotal: subtotal.toFixed(2),
      taxAmount: tax.toFixed(2),
      total: total.toFixed(2),
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      payments,
    });
  expect(response.status).toBe(201);
  return { id: response.body.id, invoiceNumber: response.body.invoiceNumber, total: response.body.total };
}

describe('reports: dashboard sales & inventory analytics', () => {
  let fixtures: Fixtures;
  let pharmacistToken: string;
  let cashierToken: string;
  let clerkToken: string;
  let accountantToken: string;

  let productA: { id: string };
  let productB: { id: string };
  let saleId: string;

  const today = todayInBusinessTimezone();
  const yesterday = plusDays(-1);

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    pharmacistToken = await tokenFor('PHARMACIST');
    cashierToken = await tokenFor('CASHIER');
    clerkToken = await tokenFor('INVENTORY_CLERK');
    accountantToken = await tokenFor('ACCOUNTANT');

    productA = await createProductFixture({
      sku: 'REP-A',
      nameAr: 'دواء اختبار أ',
      categoryId: fixtures.categoryId,
      costPrice: '5.00',
      salePrice: '9.50',
    });
    productB = await createProductFixture({
      sku: 'REP-B',
      nameAr: 'دواء اختبار ب',
      costPrice: '2.00',
      salePrice: '5.00',
    });
    await createBatchFixture({
      productId: productA.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-A',
      expiryDate: '2027-01-31',
      quantity: 20,
      costPrice: '5.00',
    });
    await createBatchFixture({
      productId: productB.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-B',
      expiryDate: '2027-06-30',
      quantity: 10,
      costPrice: '2.00',
    });
  });

  afterAll(async () => {
    await disconnect();
  });

  it("aggregates today's sales with COGS, profit, categories, products and payments", async () => {
    const sale = await createSale(
      pharmacistToken,
      [
        { productId: productA.id, quantity: 2, unitPrice: '9.50' },
        { productId: productB.id, quantity: 1, unitPrice: '5.00' },
      ],
      [
        { method: 'cash', amount: '20.00' },
        { method: 'card', amount: '7.60' },
      ],
    );
    saleId = sale.id;
    expect(sale.total).toBe('27.60');

    const report = await request(testApp)
      .get(`/api/v1/reports/sales?from=${today}&to=${today}`)
      .set(bearer(pharmacistToken));
    expect(report.status).toBe(200);

    expect(report.body.range).toMatchObject({ from: today, to: today, days: 1, previousTo: yesterday });
    expect(report.body).toMatchObject({
      revenue: '27.60',
      transactions: 1,
      itemsSold: 3,
      avgTicket: '27.60',
    });
    // No baseline yesterday → growth stays null instead of a fake percentage.
    expect(report.body.growth).toEqual({ revenuePct: null, transactionsPct: null });
    expect(report.body.previous).toMatchObject({ revenue: '0.00', transactions: 0 });

    // Gross profit = (total − VAT) − actual ISSUE-movement cost (5×2 + 2×1).
    expect(report.body.profit).toMatchObject({
      cogs: '12.00',
      netRevenue: '24.00',
      grossProfit: '12.00',
      marginPct: 50,
      previous: { cogs: '0.00', netRevenue: '0.00', grossProfit: '0.00', marginPct: null },
    });

    expect(report.body.daily).toHaveLength(1);
    expect(report.body.daily[0]).toEqual({
      date: today,
      revenue: '27.60',
      transactions: 1,
      units: 3,
    });
    expect(report.body.dailyPrevious).toEqual([{ date: yesterday, revenue: '0.00' }]);

    expect(report.body.byCategory).toEqual([
      { categoryId: fixtures.categoryId, nameAr: 'مسكنات', revenue: '19.00', units: 2 },
      { categoryId: null, nameAr: null, revenue: '5.00', units: 1 },
    ]);

    expect(report.body.topProducts[0]).toMatchObject({
      productId: productA.id,
      sku: 'REP-A',
      units: 2,
      revenue: '19.00',
      invoices: 1,
    });
    expect(report.body.topProducts[1]).toMatchObject({ productId: productB.id, units: 1 });

    expect(report.body.payments).toEqual([
      { method: 'cash', amount: '20.00', count: 1 },
      { method: 'card', amount: '7.60', count: 1 },
    ]);
  });

  it('compares with the previous period and excludes voided sales', async () => {
    // Move the first invoice into yesterday's business window (noon, so DST
    // shifts can never push it across a boundary).
    await prisma.sale.update({
      where: { id: saleId },
      data: { createdAt: new Date(businessDayStart(yesterday).getTime() + 12 * 3_600_000) },
    });

    const yesterdayReport = await request(testApp)
      .get(`/api/v1/reports/sales?from=${yesterday}&to=${yesterday}`)
      .set(bearer(pharmacistToken));
    expect(yesterdayReport.body).toMatchObject({ revenue: '27.60', transactions: 1 });

    const todayReport = await request(testApp)
      .get(`/api/v1/reports/sales?from=${today}&to=${today}`)
      .set(bearer(pharmacistToken));
    expect(todayReport.body.revenue).toBe('0.00');
    expect(todayReport.body.previous.revenue).toBe('27.60');
    expect(todayReport.body.growth).toEqual({ revenuePct: -100, transactionsPct: -100 });

    // A sale created and voided today must leave no trace in revenue or COGS.
    const toVoid = await createSale(
      pharmacistToken,
      [{ productId: productA.id, quantity: 1, unitPrice: '9.50' }],
      [{ method: 'cash', amount: '10.93' }],
    );
    const voided = await request(testApp)
      .post(`/api/v1/sales/${toVoid.id}/void`)
      .set(bearer(pharmacistToken))
      .send({ reason: 'اختبار الإلغاء' });
    expect(voided.status).toBe(200);

    const afterVoid = await request(testApp)
      .get(`/api/v1/reports/sales?from=${today}&to=${today}`)
      .set(bearer(pharmacistToken));
    expect(afterVoid.body).toMatchObject({ revenue: '0.00', transactions: 0, itemsSold: 0 });
    expect(afterVoid.body.profit.cogs).toBe('0.00');
    expect(afterVoid.body.payments).toEqual([]);
  });

  it('inventory analytics: valuation, health, expiry buckets and movers', async () => {
    // C: low stock (4 <= minStock 5) and expiring within 30 days.
    const productC = await createProductFixture({
      sku: 'REP-C',
      nameAr: 'دواء اختبار ج',
      categoryId: fixtures.categoryId,
      costPrice: '3.00',
      salePrice: '6.00',
      minStock: 5,
    });
    await createBatchFixture({
      productId: productC.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-C',
      expiryDate: plusDays(10),
      quantity: 4,
      costPrice: '3.00',
    });
    // D: expired batch with stock on hand.
    const productD = await createProductFixture({ sku: 'REP-D', nameAr: 'دواء اختبار د', costPrice: '4.00' });
    await createBatchFixture({
      productId: productD.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-D',
      expiryDate: plusDays(-1),
      quantity: 2,
      costPrice: '4.00',
    });
    // E: expiring in the 31–60 day bucket.
    const productE = await createProductFixture({
      sku: 'REP-E',
      nameAr: 'دواء اختبار هـ',
      costPrice: '1.00',
      salePrice: '2.00',
    });
    await createBatchFixture({
      productId: productE.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-E',
      expiryDate: plusDays(45),
      quantity: 3,
      costPrice: '1.00',
    });

    const report = await request(testApp)
      .get('/api/v1/reports/inventory')
      .set(bearer(clerkToken));
    expect(report.status).toBe(200);

    // A(18)×5 + B(9)×2 + C(4)×3 + D(2)×4 + E(3)×1 = 131.00 at cost;
    // A(18)×9.50 + B(9)×5 + C(4)×6 + D(2)×9.50 + E(3)×2 = 265.00 at retail.
    expect(report.body.stock).toEqual({ units: 36, costValue: '131.00', retailValue: '265.00' });

    expect(report.body.health).toEqual({ healthy: 2, low: 3, out: 0, total: 5 });
    expect(report.body.reorder.map((row: { productId: string }) => row.productId)).toEqual([
      productD.id,
      productE.id,
      productC.id,
    ]);

    const buckets = new Map(
      (report.body.expiryBuckets as Array<{ bucket: string }>).map((row) => [row.bucket, row]),
    );
    expect(buckets.get('expired')).toMatchObject({ batches: 1, units: 2, value: '8.00' });
    expect(buckets.get('d30')).toMatchObject({ batches: 1, units: 4, value: '12.00' });
    expect(buckets.get('d60')).toMatchObject({ batches: 1, units: 3, value: '3.00' });
    expect(buckets.get('d90')).toMatchObject({ batches: 0, units: 0, value: '0.00' });

    expect(report.body.upcomingExpiries).toHaveLength(2);
    expect(report.body.upcomingExpiries[0]).toMatchObject({
      productId: productC.id,
      daysToExpiry: 10,
      quantity: 4,
      value: '12.00',
    });

    const categoryRow = (
      report.body.valueByCategory as Array<{ categoryId: string | null; nameAr: string | null; value: string }>
    ).find((row) => row.categoryId === fixtures.categoryId);
    expect(categoryRow).toMatchObject({ nameAr: 'مسكنات', units: 22, value: '102.00' });

    // Sold quantities today: A = 2, B = 1 (the extra A sale was voided).
    expect(report.body.fastMoving[0]).toMatchObject({ productId: productA.id, units: 2, invoices: 1 });
    expect(report.body.fastMoving[1]).toMatchObject({ productId: productB.id, units: 1 });

    const slowIds = (report.body.slowMoving as Array<{ productId: string }>).map(
      (row) => row.productId,
    );
    expect(slowIds).toContain(productC.id);
    expect(slowIds).toContain(productD.id);
    expect(slowIds).toContain(productE.id);
    expect(slowIds).toContain(productA.id);
    expect(slowIds).toContain(productB.id);
    const neverSold = (
      report.body.slowMoving as Array<{ productId: string; units30d: number; lastSoldAt: string | null }>
    ).find((row) => row.productId === productC.id);
    expect(neverSold).toMatchObject({ units30d: 0, lastSoldAt: null });
  });

  it('hides cost and profit data from roles without cost:view', async () => {
    const cashierSales = await request(testApp)
      .get(`/api/v1/reports/sales?from=${today}&to=${today}`)
      .set(bearer(cashierToken));
    expect(cashierSales.status).toBe(200);
    expect(cashierSales.body.profit).toBeNull();
    expect(typeof cashierSales.body.revenue).toBe('string');

    const cashierInventory = await request(testApp)
      .get('/api/v1/reports/inventory')
      .set(bearer(cashierToken));
    expect(cashierInventory.status).toBe(200);
    expect(cashierInventory.body.stock.costValue).toBeNull();
    expect(cashierInventory.body.stock.retailValue).toBeNull();
    for (const bucket of cashierInventory.body.expiryBuckets) {
      expect(bucket.value).toBeNull();
    }
    for (const row of cashierInventory.body.valueByCategory) {
      expect(row.value).toBeNull();
    }
  });

  it('enforces permissions and query validation', async () => {
    // Inventory clerks have no sales:read.
    const clerkSales = await request(testApp)
      .get('/api/v1/reports/sales')
      .set(bearer(clerkToken));
    expect(clerkSales.status).toBe(403);

    const accountantSales = await request(testApp)
      .get('/api/v1/reports/sales')
      .set(bearer(accountantToken));
    expect(accountantSales.status).toBe(200);
    expect(accountantSales.body.profit).not.toBeNull();

    const anonymous = await request(testApp).get('/api/v1/reports/sales');
    expect(anonymous.status).toBe(401);

    const badFormat = await request(testApp)
      .get('/api/v1/reports/sales?from=16-10-2026')
      .set(bearer(pharmacistToken));
    expect(badFormat.status).toBe(400);

    const inverted = await request(testApp)
      .get(`/api/v1/reports/sales?from=${today}&to=${yesterday}`)
      .set(bearer(pharmacistToken));
    expect(inverted.status).toBe(400);

    const tooLong = await request(testApp)
      .get(`/api/v1/reports/sales?from=${plusDays(-400)}&to=${today}`)
      .set(bearer(pharmacistToken));
    expect(tooLong.status).toBe(400);
  });
});
