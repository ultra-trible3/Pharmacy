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

/** ISO date `days` from today (UTC), matching the batch fixture helper. */
function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('warehouses: management, guards and live stats', () => {
  let fixtures: Fixtures;
  let ownerToken: string;
  let clerkToken: string;
  let cashierToken: string;
  let createdId = '';
  let inactiveWarehouseId = '';

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    ownerToken = await tokenFor('OWNER');
    clerkToken = await tokenFor('INVENTORY_CLERK');
    cashierToken = await tokenFor('CASHIER');

    const inactive = await prisma.warehouse.create({
      data: {
        code: 'WH-INACTIVE',
        nameAr: 'مخزن قديم',
        nameEn: 'Old Store',
        address: 'الدور الثاني',
        isActive: false,
      },
    });
    inactiveWarehouseId = inactive.id;

    // A second active, non-default warehouse so ordering/search are meaningful.
    await prisma.warehouse.create({
      data: { code: 'WH-FLOOR', nameAr: 'صالة البيع', nameEn: 'Sales Floor', isActive: true },
    });

    const owner = await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } });
    await prisma.cashDrawer.create({
      data: {
        userId: owner.id,
        warehouseId: fixtures.warehouseId,
        openingBalance: '100.00',
        status: 'OPEN',
      },
    });
  });

  afterAll(async () => {
    await disconnect();
  });

  it('lists active warehouses by default, supports search and returns grouped stats', async () => {
    const near = await createProductFixture({ sku: 'STAT-A', nameAr: 'صنف قريب الانتهاء' });
    const expired = await createProductFixture({ sku: 'STAT-B', nameAr: 'صنف منتهي' });
    const far = await createProductFixture({ sku: 'STAT-C', nameAr: 'صنف بعيد' });
    const empty = await createProductFixture({ sku: 'STAT-ZERO', nameAr: 'صنف صفري' });

    await createBatchFixture({
      productId: near.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'STAT-NEAR',
      expiryDate: isoDaysFromToday(20),
      quantity: 5,
      costPrice: '10.00',
    });
    await createBatchFixture({
      productId: expired.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'STAT-EXPIRED',
      expiryDate: isoDaysFromToday(-5),
      quantity: 3,
      costPrice: '20.00',
    });
    await createBatchFixture({
      productId: far.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'STAT-FAR',
      expiryDate: isoDaysFromToday(200),
      quantity: 4,
      costPrice: '5.00',
    });
    await createBatchFixture({
      productId: empty.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'STAT-ZERO',
      expiryDate: isoDaysFromToday(60),
      quantity: 0,
      costPrice: '99.00',
    });
    // Stock in the inactive warehouse proves stats are grouped per warehouse.
    await createBatchFixture({
      productId: far.id,
      warehouseId: inactiveWarehouseId,
      lotNumber: 'STAT-OLD',
      expiryDate: isoDaysFromToday(100),
      quantity: 6,
      costPrice: '2.00',
    });

    const activeOnly = await request(testApp)
      .get('/api/v1/warehouses')
      .set(bearer(clerkToken));
    expect(activeOnly.status).toBe(200);
    expect(Array.isArray(activeOnly.body)).toBe(true);
    expect(activeOnly.body.map((warehouse: { code: string }) => warehouse.code)).toEqual([
      'MAIN',
      'WH-FLOOR',
    ]);
    expect(activeOnly.body[0]).toMatchObject({
      code: 'MAIN',
      isDefault: true,
      isActive: true,
    });
    expect(typeof activeOnly.body[0].createdAt).toBe('string');
    expect(typeof activeOnly.body[0].updatedAt).toBe('string');
    expect(activeOnly.body[0].stats).toBeUndefined();

    const withInactive = await request(testApp)
      .get('/api/v1/warehouses')
      .query({ includeInactive: 'true' })
      .set(bearer(clerkToken));
    expect(withInactive.status).toBe(200);
    expect(
      withInactive.body.map((warehouse: { code: string }) => warehouse.code),
    ).toEqual(['MAIN', 'WH-FLOOR', 'WH-INACTIVE']);

    const searched = await request(testApp)
      .get('/api/v1/warehouses')
      .query({ q: 'قديم', includeInactive: 'true', withStats: 'true' })
      .set(bearer(clerkToken));
    expect(searched.status).toBe(200);
    expect(searched.body).toHaveLength(1);
    expect(searched.body[0]).toMatchObject({
      code: 'WH-INACTIVE',
      isActive: false,
      stats: {
        skuCount: 1,
        batchCount: 1,
        unitCount: 6,
        stockValue: '12.00',
        expiringSoonCount: 0,
        expiredCount: 0,
        openShiftCount: 0,
      },
    });

    const stats = await request(testApp)
      .get('/api/v1/warehouses')
      .query({ withStats: 'true' })
      .set(bearer(clerkToken));
    expect(stats.status).toBe(200);
    const main = stats.body.find(
      (warehouse: { id: string }) => warehouse.id === fixtures.warehouseId,
    );
    expect(main.stats).toEqual({
      skuCount: 3,
      batchCount: 3,
      unitCount: 12,
      stockValue: '130.00',
      expiringSoonCount: 1,
      expiredCount: 1,
      openShiftCount: 1,
    });

    // Cashiers may read stock but never see cost valuation.
    const cashierStats = await request(testApp)
      .get('/api/v1/warehouses')
      .query({ withStats: 'true' })
      .set(bearer(cashierToken));
    expect(cashierStats.status).toBe(200);
    const cashierMain = cashierStats.body.find(
      (warehouse: { id: string }) => warehouse.id === fixtures.warehouseId,
    );
    expect(cashierMain.stats.stockValue).toBeNull();
    expect(cashierMain.stats.unitCount).toBe(12);
  });

  it('creates a warehouse, normalises the code and rejects duplicate codes', async () => {
    const created = await request(testApp)
      .post('/api/v1/warehouses')
      .set(bearer(clerkToken))
      .send({
        code: '  wh-new  ',
        nameAr: 'مخزن جديد',
        nameEn: 'New Store',
        address: 'شارع التحرير',
        isDefault: false,
        isActive: true,
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: 'WH-NEW',
      nameAr: 'مخزن جديد',
      nameEn: 'New Store',
      address: 'شارع التحرير',
      isDefault: false,
      isActive: true,
    });
    createdId = created.body.id;

    const persisted = await prisma.warehouse.findUniqueOrThrow({ where: { id: createdId } });
    expect(persisted.code).toBe('WH-NEW');
    expect(persisted.nameAr).toBe('مخزن جديد');

    const duplicateActive = await request(testApp)
      .post('/api/v1/warehouses')
      .set(bearer(clerkToken))
      .send({ code: 'wh-new', nameAr: 'نسخة مكررة' });
    expect(duplicateActive.status).toBe(409);
    expect(duplicateActive.body.error.code).toBe('CONFLICT');

    // Uniqueness also covers deactivated warehouses.
    const duplicateInactive = await request(testApp)
      .post('/api/v1/warehouses')
      .set(bearer(clerkToken))
      .send({ code: 'wh-inactive', nameAr: 'نسخة مكررة' });
    expect(duplicateInactive.status).toBe(409);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'warehouse.created', entityId: createdId },
    });
    expect(audit).not.toBeNull();
  });

  it('switches the single default atomically when creating another default', async () => {
    const created = await request(testApp)
      .post('/api/v1/warehouses')
      .set(bearer(clerkToken))
      .send({
        code: 'WH-DEFAULT',
        nameAr: 'وجهة الاستلام',
        isDefault: true,
      });
    expect(created.status).toBe(201);
    expect(created.body.isDefault).toBe(true);

    const defaults = await prisma.warehouse.findMany({ where: { isDefault: true } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(created.body.id);

    const previous = await prisma.warehouse.findUniqueOrThrow({
      where: { id: fixtures.warehouseId },
    });
    expect(previous.isDefault).toBe(false);

    // Restore MAIN as the receiving point for the remaining scenarios.
    const restored = await request(testApp)
      .patch(`/api/v1/warehouses/${fixtures.warehouseId}`)
      .set(bearer(clerkToken))
      .send({ isDefault: true });
    expect(restored.status).toBe(200);
    expect(restored.body.isDefault).toBe(true);
    const stillOne = await prisma.warehouse.count({ where: { isDefault: true } });
    expect(stillOne).toBe(1);

    // A default point can never be inactive.
    const invalid = await request(testApp)
      .patch(`/api/v1/warehouses/${created.body.id}`)
      .set(bearer(clerkToken))
      .send({ isDefault: true, isActive: false });
    expect(invalid.status).toBe(400);
  });

  it('updates fields, clears optional values and rejects code changes', async () => {
    const updated = await request(testApp)
      .patch(`/api/v1/warehouses/${createdId}`)
      .set(bearer(clerkToken))
      .send({
        nameAr: 'مخزن محدّث',
        nameEn: '',
        address: '',
        isActive: true,
      });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      id: createdId,
      code: 'WH-NEW',
      nameAr: 'مخزن محدّث',
      nameEn: null,
      address: null,
      isActive: true,
    });

    const immutable = await request(testApp)
      .patch(`/api/v1/warehouses/${createdId}`)
      .set(bearer(clerkToken))
      .send({ code: 'WH-OTHER' });
    expect(immutable.status).toBe(400);
    expect(immutable.body.error.code).toBe('VALIDATION_ERROR');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'warehouse.updated', entityId: createdId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.before).toMatchObject({ nameAr: 'مخزن جديد' });
    expect(audit!.after).toMatchObject({ nameAr: 'مخزن محدّث', nameEn: null });
  });

  it('guards deactivation: default, stock and open shifts; allows an empty warehouse', async () => {
    // Another active default may have been left by earlier tests; make MAIN the
    // default again so this test is explicit about what it is guarding.
    await request(testApp)
      .patch(`/api/v1/warehouses/${fixtures.warehouseId}`)
      .set(bearer(clerkToken))
      .send({ isDefault: true });

    const defaultAttempt = await request(testApp)
      .patch(`/api/v1/warehouses/${fixtures.warehouseId}`)
      .set(bearer(clerkToken))
      .send({ isActive: false });
    expect(defaultAttempt.status).toBe(409);
    expect(defaultAttempt.body.error.message).toContain('الافتراضي');

    const stocked = await prisma.warehouse.create({
      data: { code: 'WH-STOCK', nameAr: 'مخزن ممتلئ', isActive: true },
    });
    const product = await createProductFixture({ sku: 'STOCK-WH' });
    await createBatchFixture({
      productId: product.id,
      warehouseId: stocked.id,
      lotNumber: 'WH-STOCK-LOT',
      expiryDate: isoDaysFromToday(120),
      quantity: 7,
    });

    const stockAttempt = await request(testApp)
      .patch(`/api/v1/warehouses/${stocked.id}`)
      .set(bearer(clerkToken))
      .send({ isActive: false });
    expect(stockAttempt.status).toBe(409);
    expect(stockAttempt.body.error.message).toContain('7');

    const shiftWarehouse = await prisma.warehouse.create({
      data: { code: 'WH-SHIFT', nameAr: 'مخزن وردية', isActive: true },
    });
    const cashier = await prisma.user.findUniqueOrThrow({ where: { username: 'cashier' } });
    await prisma.cashDrawer.create({
      data: {
        userId: cashier.id,
        warehouseId: shiftWarehouse.id,
        openingBalance: '0.00',
        status: 'OPEN',
      },
    });

    const shiftAttempt = await request(testApp)
      .patch(`/api/v1/warehouses/${shiftWarehouse.id}`)
      .set(bearer(clerkToken))
      .send({ isActive: false });
    expect(shiftAttempt.status).toBe(409);
    expect(shiftAttempt.body.error.message).toContain('وردية');

    const empty = await prisma.warehouse.create({
      data: { code: 'WH-EMPTY', nameAr: 'مخزن فارغ', isActive: true },
    });

    const deactivated = await request(testApp)
      .patch(`/api/v1/warehouses/${empty.id}`)
      .set(bearer(clerkToken))
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);

    const reactivated = await request(testApp)
      .patch(`/api/v1/warehouses/${empty.id}`)
      .set(bearer(clerkToken))
      .send({ isActive: true });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.isActive).toBe(true);
  });

  it('denies create and update to read-only roles', async () => {
    const forbiddenCreate = await request(testApp)
      .post('/api/v1/warehouses')
      .set(bearer(cashierToken))
      .send({ code: 'WH-CASHIER', nameAr: 'محاولة كاشير' });
    expect(forbiddenCreate.status).toBe(403);

    const forbiddenUpdate = await request(testApp)
      .patch(`/api/v1/warehouses/${createdId}`)
      .set(bearer(cashierToken))
      .send({ nameAr: 'محاولة كاشير' });
    expect(forbiddenUpdate.status).toBe(403);

    // The same cashier can still read.
    const readable = await request(testApp)
      .get('/api/v1/warehouses')
      .set(bearer(cashierToken));
    expect(readable.status).toBe(200);
  });

  it('refuses to deactivate the last active warehouse', async () => {
    const last = await prisma.warehouse.create({
      data: { code: 'WH-LAST', nameAr: 'آخر مخزن نشط', isActive: true },
    });
    await prisma.warehouse.updateMany({
      data: { isActive: false, isDefault: false },
    });
    await prisma.warehouse.update({ where: { id: last.id }, data: { isActive: true } });

    const response = await request(testApp)
      .patch(`/api/v1/warehouses/${last.id}`)
      .set(bearer(clerkToken))
      .send({ isActive: false });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('آخر مخزن');
  });

  it('returns 404 for an unknown warehouse', async () => {
    const response = await request(testApp)
      .patch('/api/v1/warehouses/wh_missing')
      .set(bearer(clerkToken))
      .send({ nameAr: 'غير موجود' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('forces the first active warehouse to be the default and rejects an inactive first one', async () => {
    await prisma.warehouse.updateMany({ data: { isActive: false, isDefault: false } });

    const rejected = await request(testApp)
      .post('/api/v1/warehouses')
      .set(bearer(clerkToken))
      .send({ code: 'WH-FIRST-OFF', nameAr: 'أول مخزن', isActive: false });
    expect(rejected.status).toBe(400);

    const created = await request(testApp)
      .post('/api/v1/warehouses')
      .set(bearer(clerkToken))
      .send({ code: 'WH-FIRST', nameAr: 'أول مخزن نشط', isActive: true, isDefault: false });
    expect(created.status).toBe(201);
    expect(created.body.isDefault).toBe(true);
  });
});
