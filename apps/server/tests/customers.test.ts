import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  disconnect,
  resetDatabase,
  seedFixtures,
  testApp,
  tokenFor,
} from './helpers.js';

describe('customers: POS directory', () => {
  let cashierToken: string;
  let clerkToken: string;

  beforeAll(async () => {
    await resetDatabase();
    await seedFixtures();
    cashierToken = await tokenFor('CASHIER');
    clerkToken = await tokenFor('INVENTORY_CLERK');
  });

  afterAll(async () => {
    await disconnect();
  });

  it('creates a customer, searches them and keeps phone numbers unique', async () => {
    const created = await request(testApp)
      .post('/api/v1/customers')
      .set(bearer(cashierToken))
      .send({ name: 'منى عبد الله', phone: '01001112233', notes: 'عميلة دائمة' });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'منى عبد الله',
      phone: '01001112233',
      loyaltyPoints: 0,
      currentBalance: '0.00',
    });

    // The POS customer search hits `?q=`.
    const search = await request(testApp)
      .get('/api/v1/customers?q=منى')
      .set(bearer(cashierToken));
    expect(search.status).toBe(200);
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].id).toBe(created.body.id);

    const duplicate = await request(testApp)
      .post('/api/v1/customers')
      .set(bearer(cashierToken))
      .send({ name: 'عميل آخر', phone: '01001112233' });
    expect(duplicate.status).toBe(409);
  });

  it('fetches a single customer and updates it', async () => {
    const created = await request(testApp)
      .post('/api/v1/customers')
      .set(bearer(cashierToken))
      .send({ name: 'أحمد سمير' });

    const fetched = await request(testApp)
      .get(`/api/v1/customers/${created.body.id}`)
      .set(bearer(cashierToken));
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ name: 'أحمد سمير', phone: null });

    const updated = await request(testApp)
      .patch(`/api/v1/customers/${created.body.id}`)
      .set(bearer(cashierToken))
      .send({ phone: '01223344556' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'أحمد سمير', phone: '01223344556' });

    const missing = await request(testApp)
      .get('/api/v1/customers/prc_missing')
      .set(bearer(cashierToken));
    expect(missing.status).toBe(404);
  });

  it('rejects malformed payloads and hides the directory from non-sales roles', async () => {
    const invalid = await request(testApp)
      .post('/api/v1/customers')
      .set(bearer(cashierToken))
      .send({ name: 'x' });
    expect(invalid.status).toBe(400);

    const denied = await request(testApp).get('/api/v1/customers').set(bearer(clerkToken));
    expect(denied.status).toBe(403);
  });
});
