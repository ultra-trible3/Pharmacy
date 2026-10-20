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

describe('inventory: warehouse transfers', () => {
  let fixtures: Fixtures;
  let clerkToken: string;
  let cashierToken: string;
  let destinationWarehouseId: string;

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    clerkToken = await tokenFor('INVENTORY_CLERK');
    cashierToken = await tokenFor('CASHIER');
    const destination = await prisma.warehouse.create({
      data: { code: 'SHOP', nameAr: 'مخزن الصيدلية', isActive: true },
    });
    destinationWarehouseId = destination.id;
  });

  afterAll(async () => {
    await disconnect();
  });

  it('moves whole batches with a paired ledger entry and one shared reference', async () => {
    const product = await createProductFixture({ sku: 'TRF-1', nameAr: 'أموكسيسيلين 500' });
    const expiryDate = isoDaysFromToday(150);
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'TRF-LOT-1',
      expiryDate,
      quantity: 30,
      costPrice: '7.25',
      salePrice: '12.00',
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/transfers')
      .set(bearer(clerkToken))
      .send({
        fromWarehouseId: fixtures.warehouseId,
        toWarehouseId: destinationWarehouseId,
        items: [{ batchId: batch.id, quantity: 12 }],
      });

    expect(response.status).toBe(201);
    const reference = response.body.reference as string;
    expect(reference).toMatch(/^TRF-/u);
    expect(response.body.unitsTransferred).toBe(12);
    expect(response.body.linesTransferred).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      lotNumber: 'TRF-LOT-1',
      expiryDate,
      quantity: 12,
      remainingQuantity: 18,
    });

    // Source batch decremented, destination batch created with lot + expiry.
    const source = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(source.quantity).toBe(18);

    const destinationBatchId = response.body.items[0].toBatchId as string;
    const destination = await prisma.batch.findUniqueOrThrow({
      where: { id: destinationBatchId },
    });
    expect(destination.warehouseId).toBe(destinationWarehouseId);
    expect(destination.quantity).toBe(12);
    expect(destination.lotNumber).toBe('TRF-LOT-1');
    expect(destination.costPrice.toFixed(2)).toBe('7.25');
    expect(destination.salePrice?.toFixed(2)).toBe('12.00');
    expect(destination.expiryDate.toISOString().slice(0, 10)).toBe(expiryDate);

    // Two ledger rows, one reference: TRANSFER_OUT in the source warehouse,
    // TRANSFER_IN in the destination warehouse.
    const movements = await prisma.stockMovement.findMany({ where: { reference } });
    expect(movements).toHaveLength(2);

    const out = movements.find((movement) => movement.type === 'TRANSFER_OUT');
    const inbound = movements.find((movement) => movement.type === 'TRANSFER_IN');
    expect(out?.quantity).toBe(-12);
    expect(out?.warehouseId).toBe(fixtures.warehouseId);
    expect(out?.batchId).toBe(batch.id);
    expect(inbound?.quantity).toBe(12);
    expect(inbound?.warehouseId).toBe(destinationWarehouseId);
    expect(inbound?.batchId).toBe(destinationBatchId);

    // A single audit row documents the document as a whole.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'inventory.transferred' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.entityId).toBe(fixtures.warehouseId);
    expect(audit?.entityType).toBe('Warehouse');
  });

  it('merges into an existing destination batch with the same lot and expiry', async () => {
    const product = await createProductFixture({ sku: 'TRF-2' });
    const expiryDate = isoDaysFromToday(120);
    const source = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'TRF-MERGE',
      expiryDate,
      quantity: 20,
    });
    const existing = await createBatchFixture({
      productId: product.id,
      warehouseId: destinationWarehouseId,
      lotNumber: 'TRF-MERGE',
      expiryDate,
      quantity: 4,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/transfers')
      .set(bearer(clerkToken))
      .send({
        fromWarehouseId: fixtures.warehouseId,
        toWarehouseId: destinationWarehouseId,
        items: [{ batchId: source.id, quantity: 6 }],
      });

    expect(response.status).toBe(201);
    expect(response.body.items[0].toBatchId).toBe(existing.id);

    const merged = await prisma.batch.findUniqueOrThrow({ where: { id: existing.id } });
    expect(merged.quantity).toBe(10);

    const batches = await prisma.batch.count({
      where: { productId: product.id, warehouseId: destinationWarehouseId },
    });
    expect(batches).toBe(1);
  });

  it('rejects a transfer to the same warehouse', async () => {
    const product = await createProductFixture({ sku: 'TRF-SAME' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'TRF-SAME-LOT',
      expiryDate: isoDaysFromToday(90),
      quantity: 5,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/transfers')
      .set(bearer(clerkToken))
      .send({
        fromWarehouseId: fixtures.warehouseId,
        toWarehouseId: fixtures.warehouseId,
        items: [{ batchId: batch.id, quantity: 1 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');

    const untouched = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(untouched.quantity).toBe(5);
  });

  it('rejects a batch that belongs to another warehouse', async () => {
    const product = await createProductFixture({ sku: 'TRF-WRONG-WH' });
    const foreign = await createBatchFixture({
      productId: product.id,
      warehouseId: destinationWarehouseId,
      lotNumber: 'TRF-FOREIGN',
      expiryDate: isoDaysFromToday(90),
      quantity: 8,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/transfers')
      .set(bearer(clerkToken))
      .send({
        fromWarehouseId: fixtures.warehouseId,
        toWarehouseId: destinationWarehouseId,
        items: [{ batchId: foreign.id, quantity: 3 }],
      });

    expect(response.status).toBe(400);
    const untouched = await prisma.batch.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.quantity).toBe(8);
  });

  it('refuses more than the batch holds and leaves the batch untouched', async () => {
    const product = await createProductFixture({ sku: 'TRF-OVER' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'TRF-OVER-LOT',
      expiryDate: isoDaysFromToday(60),
      quantity: 4,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/transfers')
      .set(bearer(clerkToken))
      .send({
        fromWarehouseId: fixtures.warehouseId,
        toWarehouseId: destinationWarehouseId,
        items: [{ batchId: batch.id, quantity: 9 }],
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');

    const untouched = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(untouched.quantity).toBe(4);
  });

  it('rolls the whole document back when a later line fails', async () => {
    const first = await createProductFixture({ sku: 'TRF-ROLLBACK-A' });
    const second = await createProductFixture({ sku: 'TRF-ROLLBACK-B' });
    const okBatch = await createBatchFixture({
      productId: first.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'TRF-RB-A',
      expiryDate: isoDaysFromToday(80),
      quantity: 10,
    });
    const shortBatch = await createBatchFixture({
      productId: second.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'TRF-RB-B',
      expiryDate: isoDaysFromToday(80),
      quantity: 2,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/transfers')
      .set(bearer(clerkToken))
      .send({
        fromWarehouseId: fixtures.warehouseId,
        toWarehouseId: destinationWarehouseId,
        reference: 'TRF-ROLLBACK-TEST',
        items: [
          { batchId: okBatch.id, quantity: 5 },
          { batchId: shortBatch.id, quantity: 9 },
        ],
      });

    expect(response.status).toBe(409);

    // The valid first line must not have been applied.
    const firstAfter = await prisma.batch.findUniqueOrThrow({ where: { id: okBatch.id } });
    expect(firstAfter.quantity).toBe(10);
    const movements = await prisma.stockMovement.count({
      where: { reference: 'TRF-ROLLBACK-TEST' },
    });
    expect(movements).toBe(0);
  });

  it('denies transfers to a cashier', async () => {
    const product = await createProductFixture({ sku: 'TRF-PERM' });
    const batch = await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'TRF-PERM-LOT',
      expiryDate: isoDaysFromToday(70),
      quantity: 5,
    });

    const response = await request(testApp)
      .post('/api/v1/inventory/transfers')
      .set(bearer(cashierToken))
      .send({
        fromWarehouseId: fixtures.warehouseId,
        toWarehouseId: destinationWarehouseId,
        items: [{ batchId: batch.id, quantity: 1 }],
      });

    expect(response.status).toBe(403);
    const untouched = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(untouched.quantity).toBe(5);
  });
});
