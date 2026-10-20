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

describe('audit: activity log endpoint', () => {
  let ownerToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    await resetDatabase();
    await seedFixtures();
    ownerToken = await tokenFor('OWNER');
    cashierToken = await tokenFor('CASHIER');

    // Produce trail entries through real mutations.
    await request(testApp)
      .post('/api/v1/customers')
      .set(bearer(cashierToken))
      .send({ name: 'Test Customer' });
    await request(testApp)
      .post('/api/v1/categories')
      .set(bearer(ownerToken))
      .send({ code: 'ANTB', nameAr: 'Antibiotics' });
  });

  afterAll(async () => {
    await disconnect();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(testApp).get('/api/v1/audit');
    expect(response.status).toBe(401);
  });

  it('rejects roles without audit:read', async () => {
    const response = await request(testApp).get('/api/v1/audit').set(bearer(cashierToken));
    expect(response.status).toBe(403);
  });

  it('lists entries newest-first with the acting user attached', async () => {
    const response = await request(testApp).get('/api/v1/audit').set(bearer(ownerToken));

    expect(response.status).toBe(200);
    const { items, total } = response.body;
    expect(total).toBeGreaterThanOrEqual(2);
    expect(items.map((entry: { action: string }) => entry.action)).toEqual(
      expect.arrayContaining(['category.created', 'customer.created']),
    );

    const categoryEntry = items.find(
      (entry: { action: string }) => entry.action === 'category.created',
    );
    expect(categoryEntry).toMatchObject({ entityType: 'Category' });
    expect(categoryEntry.user).toMatchObject({ username: 'owner' });

    // Newest first.
    const timestamps = items.map((entry: { createdAt: string }) => entry.createdAt);
    expect([...timestamps].sort().reverse()).toEqual(timestamps);
  });

  it('filters by action and paginates', async () => {
    const filtered = await request(testApp)
      .get('/api/v1/audit?action=category.created')
      .set(bearer(ownerToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0]).toMatchObject({ action: 'category.created' });
    expect(filtered.body.total).toBe(1);

    const paginated = await request(testApp)
      .get('/api/v1/audit?page=1&pageSize=1')
      .set(bearer(ownerToken));
    expect(paginated.status).toBe(200);
    expect(paginated.body.items).toHaveLength(1);
    expect(paginated.body.pageSize).toBe(1);
    expect(paginated.body.total).toBeGreaterThanOrEqual(2);
  });

  it('scopes rows by userId when provided', async () => {
    const ownerEntries = await request(testApp)
      .get('/api/v1/audit?action=category.created&userId=unknown-user')
      .set(bearer(ownerToken));
    expect(ownerEntries.status).toBe(200);
    expect(ownerEntries.body.items).toHaveLength(0);
    expect(ownerEntries.body.total).toBe(0);
  });
});
