import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import {
  bearer,
  createProductFixture,
  disconnect,
  resetDatabase,
  seedFixtures,
  testApp,
  tokenFor,
  type Fixtures,
} from './helpers.js';

describe('purchases: goods receipts, history and totals', () => {
  let fixtures: Fixtures;
  let clerkToken: string;
  let cashierToken: string;
  let accountantToken: string;
  let pharmacistToken: string;

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    clerkToken = await tokenFor('INVENTORY_CLERK');
    cashierToken = await tokenFor('CASHIER');
    accountantToken = await tokenFor('ACCOUNTANT');
    pharmacistToken = await tokenFor('PHARMACIST');
  });

  afterAll(async () => {
    await disconnect();
  });

  it('records a purchase and returns it in the grouped history with totals', async () => {
    const productA = await createProductFixture({ sku: 'PUR-A' });
    const productB = await createProductFixture({ sku: 'PUR-B' });

    const created = await request(testApp)
      .post('/api/v1/purchases')
      .set(bearer(clerkToken))
      .send({
        warehouseId: fixtures.warehouseId,
        supplierId: fixtures.supplierId,
        reference: 'GRN-PUR-1',
        items: [
          {
            productId: productA.id,
            lotNumber: 'LOT-A',
            expiryDate: '2027-01-31',
            quantity: 10,
            costPrice: '5.00',
          },
          {
            productId: productB.id,
            lotNumber: 'LOT-B',
            expiryDate: '2027-06-30',
            quantity: 4,
            costPrice: '12.50',
          },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      reference: 'GRN-PUR-1',
      unitsReceived: 14,
      totalCost: '100.00',
    });

    // The supplier payable grew by the receipt total.
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: fixtures.supplierId },
    });
    expect(Number(supplier.balance)).toBe(100);

    // Grouped history: one row per receipt with lines/units/value.
    const list = await request(testApp)
      .get('/api/v1/purchases?page=1&pageSize=25')
      .set(bearer(clerkToken));
    expect(list.status).toBe(200);
    const row = list.body.items.find(
      (item: { reference: string }) => item.reference === 'GRN-PUR-1',
    );
    expect(row).toMatchObject({
      linesCount: 2,
      unitsCount: 14,
      totalCost: '100.00',
      supplierNameAr: 'شركة الأدوية المصرية',
      warehouseNameAr: 'المخزن الرئيسي',
    });
    expect(row.userName).toBeTruthy();
    expect(list.body.summary).toMatchObject({
      totalCost: '100.00',
      receiptsTotal: 1,
      unitsTotal: 14,
    });

    // Detail: lines with products, lots, expiry and line totals.
    const detail = await request(testApp)
      .get('/api/v1/purchases/GRN-PUR-1')
      .set(bearer(clerkToken));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      reference: 'GRN-PUR-1',
      linesCount: 2,
      unitsCount: 14,
      totalCost: '100.00',
      supplierNameAr: 'شركة الأدوية المصرية',
    });
    const lineA = detail.body.lines.find((line: { sku: string }) => line.sku === 'PUR-A');
    expect(lineA).toMatchObject({
      productId: productA.id,
      lotNumber: 'LOT-A',
      expiryDate: '2027-01-31',
      quantity: 10,
      unitCost: '5.00',
      lineTotal: '50.00',
    });

    // Search matches the reference and the supplier name.
    const byReference = await request(testApp)
      .get('/api/v1/purchases?q=GRN-PUR-1')
      .set(bearer(clerkToken));
    expect(byReference.body.items).toHaveLength(1);
    const bySupplier = await request(testApp)
      .get(`/api/v1/purchases?q=${encodeURIComponent('الأدوية')}`)
      .set(bearer(clerkToken));
    expect(bySupplier.body.items.length).toBeGreaterThan(0);
    const noMatch = await request(testApp)
      .get('/api/v1/purchases?q=NOTHING-HERE')
      .set(bearer(clerkToken));
    expect(noMatch.body.items).toHaveLength(0);

    const missing = await request(testApp)
      .get('/api/v1/purchases/GRN-NOPE')
      .set(bearer(clerkToken));
    expect(missing.status).toBe(404);
  });

  it('generates a reference when omitted and keeps receipts separate', async () => {
    const product = await createProductFixture({ sku: 'PUR-C' });
    const created = await request(testApp)
      .post('/api/v1/purchases')
      .set(bearer(clerkToken))
      .send({
        warehouseId: fixtures.warehouseId,
        items: [
          {
            productId: product.id,
            lotNumber: 'LOT-C',
            expiryDate: '2027-03-31',
            quantity: 3,
            costPrice: '2.00',
          },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body.reference).toMatch(/^GRN-/);

    // No supplier means no payable movement; the receipt still shows up.
    const list = await request(testApp).get('/api/v1/purchases').set(bearer(clerkToken));
    const rows = list.body.items as Array<{ reference: string }>;
    expect(rows.some((row) => row.reference === created.body.reference)).toBe(true);

    const byReference = await request(testApp)
      .get(`/api/v1/purchases?q=${encodeURIComponent(created.body.reference)}`)
      .set(bearer(clerkToken));
    expect(
      (byReference.body.items as Array<{ reference: string }>).map((item) => item.reference),
    ).toContain(created.body.reference);

    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: fixtures.supplierId },
    });
    expect(Number(supplier.balance)).toBe(100); // unchanged by the supplier-less receipt
  });

  it('enforces purchases permissions (cashier blocked, accountant/pharmacist read-only)', async () => {
    const deniedList = await request(testApp).get('/api/v1/purchases').set(bearer(cashierToken));
    expect(deniedList.status).toBe(403);

    const allowedList = await request(testApp)
      .get('/api/v1/purchases')
      .set(bearer(accountantToken));
    expect(allowedList.status).toBe(200);

    const pharmacistList = await request(testApp)
      .get('/api/v1/purchases')
      .set(bearer(pharmacistToken));
    expect(pharmacistList.status).toBe(200);

    const product = await createProductFixture({ sku: 'PUR-D' });
    const deniedCreate = await request(testApp)
      .post('/api/v1/purchases')
      .set(bearer(pharmacistToken))
      .send({
        warehouseId: fixtures.warehouseId,
        items: [
          {
            productId: product.id,
            lotNumber: 'LOT-D',
            expiryDate: '2027-03-31',
            quantity: 1,
            costPrice: '1.00',
          },
        ],
      });
    expect(deniedCreate.status).toBe(403);

    const badBody = await request(testApp)
      .post('/api/v1/purchases')
      .set(bearer(clerkToken))
      .send({ warehouseId: fixtures.warehouseId, items: [] });
    expect(badBody.status).toBe(400);
  });
});
