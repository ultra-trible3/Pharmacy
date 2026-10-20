import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('suppliers: management', () => {
  let clerkToken: string;
  let cashierToken: string;
  let fixtures: Fixtures;

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    clerkToken = await tokenFor('INVENTORY_CLERK');
    cashierToken = await tokenFor('CASHIER');
  });

  afterAll(async () => {
    await disconnect();
  });

  it('creates a supplier, normalises the code and rejects duplicates', async () => {
    const created = await request(testApp)
      .post('/api/v1/suppliers')
      .set(bearer(clerkToken))
      .send({
        code: 'ph-01',
        nameAr: 'صيدلية النور',
        phone: '01000000001',
        openingBalance: '250.5',
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: 'PH-01',
      nameAr: 'صيدلية النور',
      phone: '01000000001',
      balance: '250.50',
      isActive: true,
    });

    const search = await request(testApp)
      .get('/api/v1/suppliers')
      .query({ q: 'النور' })
      .set(bearer(clerkToken));
    expect(search.status).toBe(200);
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].id).toBe(created.body.id);
    expect(search.body.items[0].email).toBeNull();
    expect(typeof search.body.items[0].createdAt).toBe('string');

    const duplicate = await request(testApp)
      .post('/api/v1/suppliers')
      .set(bearer(clerkToken))
      .send({ code: 'PH-01', nameAr: 'مورد آخر' });
    expect(duplicate.status).toBe(409);
  });

  it('updates fields, clears blanks and rejects immutable columns', async () => {
    const created = await request(testApp)
      .post('/api/v1/suppliers')
      .set(bearer(clerkToken))
      .send({
        code: 'PH-02',
        nameAr: 'مورد قابل للتعديل',
        phone: '01111111111',
        email: 'sales@supplier.test',
      });

    const updated = await request(testApp)
      .patch(`/api/v1/suppliers/${created.body.id}`)
      .set(bearer(clerkToken))
      .send({ nameAr: 'مورد معدّل', phone: '', isActive: false });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      nameAr: 'مورد معدّل',
      phone: null,
      email: 'sales@supplier.test',
      isActive: false,
    });

    // The code and the opening balance are fixed at creation time.
    const immutable = await request(testApp)
      .patch(`/api/v1/suppliers/${created.body.id}`)
      .set(bearer(clerkToken))
      .send({ code: 'PH-99' });
    expect(immutable.status).toBe(400);

    const missing = await request(testApp)
      .patch('/api/v1/suppliers/sup_missing')
      .set(bearer(clerkToken))
      .send({ nameAr: 'لا يوجد' });
    expect(missing.status).toBe(404);
  });

  it('hard-deletes a supplier that was never transacted', async () => {
    const created = await request(testApp)
      .post('/api/v1/suppliers')
      .set(bearer(clerkToken))
      .send({ code: 'PH-03', nameAr: 'مورد بلا حركات' });

    const deleted = await request(testApp)
      .delete(`/api/v1/suppliers/${created.body.id}`)
      .set(bearer(clerkToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ deleted: true, deactivated: false });

    const again = await request(testApp)
      .delete(`/api/v1/suppliers/${created.body.id}`)
      .set(bearer(clerkToken));
    expect(again.status).toBe(404);
  });

  it('deactivates suppliers with an outstanding balance instead of deleting', async () => {
    const owing = await request(testApp)
      .post('/api/v1/suppliers')
      .set(bearer(clerkToken))
      .send({ code: 'PH-04', nameAr: 'مورد عليه رصيد', openingBalance: '100' });

    const deleted = await request(testApp)
      .delete(`/api/v1/suppliers/${owing.body.id}`)
      .set(bearer(clerkToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ deleted: false, deactivated: true });
    expect(deleted.body.reason).toBeTruthy();

    // Inactive rows are hidden unless `includeInactive=true`.
    const hidden = await request(testApp)
      .get('/api/v1/suppliers')
      .query({ q: 'عليه رصيد' })
      .set(bearer(clerkToken));
    expect(hidden.body.items).toHaveLength(0);

    const included = await request(testApp)
      .get('/api/v1/suppliers')
      .query({ q: 'عليه رصيد', includeInactive: 'true' })
      .set(bearer(clerkToken));
    expect(included.body.items).toHaveLength(1);
    expect(included.body.items[0].isActive).toBe(false);
  });

  it('deactivates suppliers with stock history instead of deleting', async () => {
    const supplier = await request(testApp)
      .post('/api/v1/suppliers')
      .set(bearer(clerkToken))
      .send({ code: 'PH-05', nameAr: 'مورد له مخزون' });

    const product = await createProductFixture();
    await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      supplierId: supplier.body.id,
      lotNumber: 'LOT-SUP-1',
      expiryDate: '2027-06-01',
      quantity: 12,
    });

    const deleted = await request(testApp)
      .delete(`/api/v1/suppliers/${supplier.body.id}`)
      .set(bearer(clerkToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ deleted: false, deactivated: true });
  });

  it('keeps supplier management away from roles without the permission', async () => {
    const denied = await request(testApp).get('/api/v1/suppliers').set(bearer(cashierToken));
    expect(denied.status).toBe(403);

    // Pharmacists may read but not write.
    const pharmacistToken = await tokenFor('PHARMACIST');
    const listed = await request(testApp).get('/api/v1/suppliers').set(bearer(pharmacistToken));
    expect(listed.status).toBe(200);

    const write = await request(testApp)
      .post('/api/v1/suppliers')
      .set(bearer(pharmacistToken))
      .send({ code: 'PH-06', nameAr: 'ممنوع' });
    expect(write.status).toBe(403);

    const remove = await request(testApp)
      .delete(`/api/v1/suppliers/${fixtures.supplierId}`)
      .set(bearer(pharmacistToken));
    expect(remove.status).toBe(403);
  });
});
