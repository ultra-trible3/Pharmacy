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

describe('inventory: receipts, FEFO batches, stock levels and adjustments', () => {
  let fixtures: Fixtures;
  let clerkToken: string;
  let ownerToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    clerkToken = await tokenFor('INVENTORY_CLERK');
    ownerToken = await tokenFor('OWNER');
    cashierToken = await tokenFor('CASHIER');
  });

  afterAll(async () => {
    await disconnect();
  });

  it('receives stock atomically: batches + ledger + supplier balance', async () => {
    const product = await createProductFixture({ sku: 'REC-1', nameAr: 'صنف الاستلام' });

    const response = await request(testApp)
      .post('/api/v1/inventory/receipts')
      .set(bearer(clerkToken))
      .send({
        warehouseId: fixtures.warehouseId,
        supplierId: fixtures.supplierId,
        reference: 'GRN-TEST-1',
        items: [
          {
            productId: product.id,
            lotNumber: 'LOT-A',
            expiryDate: isoDaysFromToday(200),
            quantity: 20,
            costPrice: '10.50',
          },
          {
            productId: product.id,
            lotNumber: 'LOT-B',
            expiryDate: isoDaysFromToday(400),
            quantity: 12,
            costPrice: '7.25',
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      reference: 'GRN-TEST-1',
      linesReceived: 2,
      unitsReceived: 32,
      totalCost: '297.00',
    });
    expect(response.body.batches).toHaveLength(2);

    // Both batches persisted with the right quantities.
    const batches = await prisma.batch.findMany({
      where: { productId: product.id },
      orderBy: { lotNumber: 'asc' },
    });
    expect(batches.map((batch) => batch.lotNumber)).toEqual(['LOT-A', 'LOT-B']);
    expect(batches.map((batch) => batch.quantity)).toEqual([20, 12]);

    // One inbound ledger row per line, tied to the receipt reference.
    const movements = await prisma.stockMovement.findMany({
      where: { productId: product.id, type: 'RECEIPT' },
    });
    expect(movements).toHaveLength(2);
    expect(movements.every((movement) => movement.reference === 'GRN-TEST-1')).toBe(true);
    expect(movements.every((movement) => movement.quantity > 0)).toBe(true);

    // Payables were increased by the landed cost.
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: fixtures.supplierId } });
    expect(supplier.balance.toFixed(2)).toBe('297.00');

    // Receipts are audited.
    const audit = await prisma.auditLog.findFirst({ where: { action: 'inventory.receipt' } });
    expect(audit).not.toBeNull();
  });

  it('upserts the same lot instead of duplicating the batch', async () => {
    const product = await createProductFixture({ sku: 'REC-UPSERT' });
    const expiryDate = isoDaysFromToday(150);

    const body = {
      warehouseId: fixtures.warehouseId,
      items: [
        { productId: product.id, lotNumber: 'SAME-LOT', expiryDate, quantity: 5, costPrice: '3.00' },
      ],
    };

    const first = await request(testApp)
      .post('/api/v1/inventory/receipts')
      .set(bearer(clerkToken))
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(testApp)
      .post('/api/v1/inventory/receipts')
      .set(bearer(clerkToken))
      .send(body);
    expect(second.status).toBe(201);

    const batches = await prisma.batch.findMany({ where: { productId: product.id } });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.quantity).toBe(10);
  });

  it('refuses a receipt for an inactive product or unknown warehouse', async () => {
    const inactive = await createProductFixture({ sku: 'REC-INACTIVE', isActive: false });

    const badProduct = await request(testApp)
      .post('/api/v1/inventory/receipts')
      .set(bearer(clerkToken))
      .send({
        warehouseId: fixtures.warehouseId,
        items: [
          {
            productId: inactive.id,
            lotNumber: 'LOT-X',
            expiryDate: isoDaysFromToday(100),
            quantity: 1,
            costPrice: '1.00',
          },
        ],
      });
    expect(badProduct.status).toBe(400);

    const badWarehouse = await request(testApp)
      .post('/api/v1/inventory/receipts')
      .set(bearer(clerkToken))
      .send({
        warehouseId: 'does-not-exist',
        items: [
          {
            productId: inactive.id,
            lotNumber: 'LOT-X',
            expiryDate: isoDaysFromToday(100),
            quantity: 1,
            costPrice: '1.00',
          },
        ],
      });
    expect(badWarehouse.status).toBe(404);
  });

  it('lists batches in FEFO order with expiry flags', async () => {
    const expired = await createProductFixture({ sku: 'FEFO-EXPIRED' });
    const near = await createProductFixture({ sku: 'FEFO-NEAR' });
    const far = await createProductFixture({ sku: 'FEFO-FAR' });

    await createBatchFixture({
      productId: expired.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-EXPIRED',
      expiryDate: isoDaysFromToday(-20),
      quantity: 9,
    });
    await createBatchFixture({
      productId: near.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-NEAR',
      expiryDate: isoDaysFromToday(10),
      quantity: 9,
    });
    await createBatchFixture({
      productId: far.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-FAR',
      expiryDate: isoDaysFromToday(400),
      quantity: 9,
    });

    const response = await request(testApp)
      .get('/api/v1/inventory/batches')
      .query({ includeExpired: 'true', inStockOnly: 'true', pageSize: 100 })
      .set(bearer(clerkToken));

    expect(response.status).toBe(200);
    const items = response.body.items as Array<{
      lotNumber: string;
      expiryDate: string;
      daysToExpiry: number;
      isExpired: boolean;
      isNearExpiry: boolean;
      quantity: number;
      stockValue: string;
    }>;

    const relevant = items.filter((item) => item.lotNumber.startsWith('LOT-'));
    const expiries = relevant.map((item) => item.expiryDate);
    expect(expiries).toEqual([...expiries].sort());

    const expiredRow = items.find((item) => item.lotNumber === 'LOT-EXPIRED')!;
    expect(expiredRow.isExpired).toBe(true);
    expect(expiredRow.daysToExpiry).toBeLessThan(0);

    const nearRow = items.find((item) => item.lotNumber === 'LOT-NEAR')!;
    expect(nearRow.isNearExpiry).toBe(true);
    expect(nearRow.isExpired).toBe(false);

    const farRow = items.find((item) => item.lotNumber === 'LOT-FAR')!;
    expect(farRow.isNearExpiry).toBe(false);

    // The clerk holds cost:view, so the stock value is real money (9 x 5.00).
    expect(farRow.stockValue).toBe('45.00');
  });

  it('honours includeExpired=false and inStockOnly=true', async () => {
    const withoutExpired = await request(testApp)
      .get('/api/v1/inventory/batches')
      .query({ includeExpired: 'false', pageSize: 100 })
      .set(bearer(clerkToken));
    expect(withoutExpired.status).toBe(200);
    expect(
      (withoutExpired.body.items as Array<{ lotNumber: string }>).some(
        (item) => item.lotNumber === 'LOT-EXPIRED',
      ),
    ).toBe(false);

    const zero = await createProductFixture({ sku: 'ZERO-QTY' });
    await createBatchFixture({
      productId: zero.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-ZERO',
      expiryDate: isoDaysFromToday(120),
      quantity: 0,
    });

    const inStock = await request(testApp)
      .get('/api/v1/inventory/batches')
      .query({ inStockOnly: 'true', pageSize: 200 })
      .set(bearer(clerkToken));
    expect(
      (inStock.body.items as Array<{ lotNumber: string }>).some(
        (item) => item.lotNumber === 'LOT-ZERO',
      ),
    ).toBe(false);
  });

  it('hides stock valuation from roles without cost:view', async () => {
    const response = await request(testApp)
      .get('/api/v1/inventory/stock')
      .query({ q: 'صنف الاستلام' })
      .set(bearer(cashierToken));

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].totalQuantity).toBe(32);
    expect(response.body.items[0].stockValue).toBe('0.00');
  });

  it('aggregates stock levels and flags low stock', async () => {
    const product = await createProductFixture({
      sku: 'LOW-1',
      nameAr: 'صنف ناقص',
      minStock: 100,
    });
    await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOW-LOT',
      expiryDate: isoDaysFromToday(60),
      quantity: 3,
    });

    const response = await request(testApp)
      .get('/api/v1/inventory/stock')
      .query({ q: 'LOW-1' })
      .set(bearer(ownerToken));

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      sku: 'LOW-1',
      totalQuantity: 3,
      minStock: 100,
      isLowStock: true,
      stockValue: '15.00',
    });
  });

  it('derives alerts from live data', async () => {
    // A brand new product with no stock is always below its reorder level.
    const product = await createProductFixture({ sku: 'ALERT-EMPTY', minStock: 5 });

    const response = await request(testApp)
      .get('/api/v1/inventory/alerts')
      .set(bearer(ownerToken));

    expect(response.status).toBe(200);
    expect(typeof response.body.nearExpiryDays).toBe('number');
    expect(response.body.summary.lowStockCount).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.expiredCount).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.totalStockUnits).toBeGreaterThan(0);

    expect(
      (response.body.lowStock as Array<{ productId: string }>).some(
        (row) => row.productId === product.id,
      ),
    ).toBe(true);
    expect(
      (response.body.expired as Array<{ lotNumber: string }>).some(
        (row) => row.lotNumber === 'LOT-EXPIRED',
      ),
    ).toBe(true);
  });

  it('records an inbound adjustment as a new batch when no batch is given', async () => {
    const product = await createProductFixture({ sku: 'ADJ-IN-NEW' });

    const response = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(clerkToken))
      .send({
        productId: product.id,
        warehouseId: fixtures.warehouseId,
        type: 'ADJUSTMENT_IN',
        quantity: 15,
        lotNumber: 'ADJ-LOT',
        expiryDate: isoDaysFromToday(180),
        costPrice: '4.40',
        reason: 'تسوية جرد افتتاحي',
      });

    expect(response.status).toBe(201);
    expect(response.body.quantity).toBe(15);
    expect(response.body.allocations[0].quantity).toBe(15);

    const batch = await prisma.batch.findFirst({
      where: { productId: product.id, lotNumber: 'ADJ-LOT' },
    });
    expect(batch).not.toBeNull();
    expect(batch!.quantity).toBe(15);
    expect(batch!.costPrice.toFixed(2)).toBe('4.40');

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, type: 'ADJUSTMENT_IN' },
    });
    expect(movement).not.toBeNull();
    expect(movement!.quantity).toBe(15);
    expect(movement!.reason).toBe('تسوية جرد افتتاحي');
  });

  it('requires lot and expiry when adding stock without an existing batch', async () => {
    const product = await createProductFixture({ sku: 'ADJ-IN-NOLOT' });

    const response = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(clerkToken))
      .send({
        productId: product.id,
        warehouseId: fixtures.warehouseId,
        type: 'ADJUSTMENT_IN',
        quantity: 5,
        reason: 'بدون تشغيلة',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('رقم التشغيلة');
  });

  it('increments an existing batch when a batchId is supplied', async () => {
    const product = await createProductFixture({ sku: 'ADJ-IN-EXISTING' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'EX-LOT',
      expiryDate: isoDaysFromToday(200),
      quantity: 10,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(clerkToken))
      .send({
        productId: product.id,
        warehouseId: fixtures.warehouseId,
        batchId: batch.id,
        type: 'COUNT_GAIN',
        quantity: 4,
        reason: 'زيادة جرد',
      });

    expect(response.status).toBe(201);
    const updated = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updated.quantity).toBe(14);
  });

  it('drains the earliest-expiring batch first (FEFO) for outbound movement', async () => {
    const product = await createProductFixture({ sku: 'FEFO-OUT' });
    const early = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'EARLY',
      expiryDate: isoDaysFromToday(30),
      quantity: 10,
    });
    const late = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LATE',
      expiryDate: isoDaysFromToday(300),
      quantity: 10,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(clerkToken))
      .send({
        productId: product.id,
        warehouseId: fixtures.warehouseId,
        type: 'ADJUSTMENT_OUT',
        quantity: 14,
        reason: 'صرف/تلف',
      });

    expect(response.status).toBe(201);
    expect(response.body.quantity).toBe(-14);

    const earlyAfter = await prisma.batch.findUniqueOrThrow({ where: { id: early.id } });
    const lateAfter = await prisma.batch.findUniqueOrThrow({ where: { id: late.id } });
    // 10 from EARLY (now empty) + 4 from LATE.
    expect(earlyAfter.quantity).toBe(0);
    expect(lateAfter.quantity).toBe(6);

    // Ledger rows are signed: outbound is negative.
    const movements = await prisma.stockMovement.findMany({
      where: { productId: product.id, type: 'ADJUSTMENT_OUT' },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements.map((movement) => movement.quantity).sort()).toEqual([-10, -4]);
  });

  it('rejects an outbound movement larger than the total available stock', async () => {
    const product = await createProductFixture({ sku: 'OVERSELL' });
    await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'SMALL',
      expiryDate: isoDaysFromToday(45),
      quantity: 3,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(clerkToken))
      .send({
        productId: product.id,
        warehouseId: fixtures.warehouseId,
        type: 'ADJUSTMENT_OUT',
        quantity: 10,
        reason: 'محاولة صرف زائد',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');

    // Nothing was deducted.
    const batch = await prisma.batch.findFirstOrThrow({ where: { productId: product.id } });
    expect(batch.quantity).toBe(3);
  });

  it('rejects an outbound movement that exceeds a specific batch', async () => {
    const product = await createProductFixture({ sku: 'BATCH-SHORT' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'SHORT-LOT',
      expiryDate: isoDaysFromToday(45),
      quantity: 5,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(clerkToken))
      .send({
        productId: product.id,
        warehouseId: fixtures.warehouseId,
        batchId: batch.id,
        type: 'ADJUSTMENT_OUT',
        quantity: 9,
        reason: 'صرف أكثر من المتاح',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');

    const after = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.quantity).toBe(5);
  });

  it('validates the movement type and quantity', async () => {
    const product = await createProductFixture({ sku: 'ADJ-BADTYPE' });

    const badType = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(clerkToken))
      .send({
        productId: product.id,
        warehouseId: fixtures.warehouseId,
        type: 'NOT_A_TYPE',
        quantity: 1,
        reason: 'نوع غير معروف',
      });
    expect(badType.status).toBe(400);

    const zeroQty = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(clerkToken))
      .send({
        productId: product.id,
        warehouseId: fixtures.warehouseId,
        type: 'ADJUSTMENT_IN',
        quantity: 0,
        lotNumber: 'Z',
        expiryDate: isoDaysFromToday(90),
        reason: 'كمية صفر',
      });
    expect(zeroQty.status).toBe(400);
  });

  it('exposes the signed movement ledger with filters', async () => {
    const response = await request(testApp)
      .get('/api/v1/inventory/movements')
      .query({ type: 'RECEIPT', pageSize: 50 })
      .set(bearer(clerkToken));

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(
      (response.body.items as Array<{ type: string }>).every((item) => item.type === 'RECEIPT'),
    ).toBe(true);
    expect(response.body.items[0].reference).toBeTruthy();
    expect(response.body.items[0].userName).toBe('مستخدم INVENTORY_CLERK');
  });

  it('never drives a batch negative under concurrent outbound adjustments', async () => {
    const product = await createProductFixture({ sku: 'RACE-OUT' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'RACE-LOT',
      expiryDate: isoDaysFromToday(120),
      quantity: 50,
    });

    const body = {
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      type: 'ADJUSTMENT_OUT' as const,
      quantity: 30,
      reason: 'اختبار تزامن',
    };

    const [first, second] = await Promise.all([
      request(testApp).post('/api/v1/inventory/adjustments').set(bearer(clerkToken)).send(body),
      request(testApp).post('/api/v1/inventory/adjustments').set(bearer(clerkToken)).send(body),
    ]);

    const statuses = [first.status, second.status].sort();
    // Exactly one may take the stock; the other must be refused.
    expect(statuses).toEqual([201, 409]);

    const after = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.quantity).toBe(20);
    expect(after.quantity).toBeGreaterThanOrEqual(0);
  });

  it('never loses units when two receipts for the same lot run concurrently', async () => {
    const product = await createProductFixture({ sku: 'RACE-IN' });
    const expiryDate = isoDaysFromToday(240);

    const body = {
      warehouseId: fixtures.warehouseId,
      items: [
        { productId: product.id, lotNumber: 'RACE-IN-LOT', expiryDate, quantity: 10, costPrice: '2.00' },
      ],
    };

    const responses = await Promise.all([
      request(testApp).post('/api/v1/inventory/receipts').set(bearer(clerkToken)).send(body),
      request(testApp).post('/api/v1/inventory/receipts').set(bearer(clerkToken)).send(body),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);

    const batches = await prisma.batch.findMany({ where: { productId: product.id } });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.quantity).toBe(20);
  });

  it('denies stock adjustments to a cashier', async () => {
    const product = await createProductFixture({ sku: 'RBAC-ADJ' });

    const response = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(cashierToken))
      .send({
        productId: product.id,
        warehouseId: fixtures.warehouseId,
        type: 'ADJUSTMENT_IN',
        quantity: 1,
        lotNumber: 'X',
        expiryDate: isoDaysFromToday(90),
        reason: 'محاولة كاشير',
      });

    expect(response.status).toBe(403);
  });
});
