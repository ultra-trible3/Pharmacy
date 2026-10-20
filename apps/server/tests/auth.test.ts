import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import {
  TEST_PASSWORD,
  bearer,
  disconnect,
  resetDatabase,
  seedFixtures,
  testApp,
  tokenFor,
} from './helpers.js';

describe('authentication, throttling and authorisation', () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  afterAll(async () => {
    await disconnect();
  });

  it('rejects a missing or malformed body with a validation envelope', async () => {
    const response = await request(testApp).post('/api/v1/auth/login').send({ username: 'ow' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    // Validation details are a flat list of { field, message, code } entries.
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect(response.body.error.details[0].field).toMatch(/^body\./u);
  });

  it('rejects an unknown username without leaking whether it exists', async () => {
    const response = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'ghost', password: TEST_PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(response.body.error.message).toContain('غير صحيحة');
  });

  it('signs a valid user in and returns a usable access token', async () => {
    const response = await request(testApp)
      .post('/api/v1/auth/login')
      .set('x-terminal-id', 'TERM-TEST01')
      .send({ username: 'owner', password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ username: 'owner', role: 'OWNER' });
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).toBeTruthy();
    expect(response.body.accessTokenExpiresIn).toBeGreaterThan(0);
    // OWNER is expanded to the full permission set.
    expect(response.body.permissions).toContain('users:manage');

    // The refresh token is stored only as a hash — never in clear text.
    const sessions = await prisma.session.findMany({ where: { userId: response.body.user.id } });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session.tokenHash !== response.body.refreshToken)).toBe(true);
    expect(sessions.some((session) => session.terminalId === 'TERM-TEST01')).toBe(true);

    // A successful login is written to the append-only audit trail.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login.success' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('locks the account after the configured number of failures, then reports the lock', async () => {
    const maxAttempts = Number(process.env.MAX_LOGIN_ATTEMPTS ?? '5');
    let lastMessage = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ username: 'cashier', password: 'WrongPass123' });

      expect(response.status).toBe(401);
      lastMessage = response.body.error.message;
    }

    // The final failure is the one that trips the lock.
    expect(lastMessage).toContain('قفل');

    const locked = await prisma.user.findUniqueOrThrow({ where: { username: 'cashier' } });
    expect(locked.lockedUntil).not.toBeNull();
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Even the correct password is refused while the lock is active.
    const whileLocked = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'cashier', password: TEST_PASSWORD });
    expect(whileLocked.status).toBe(401);
    expect(whileLocked.body.error.message).toContain('مقفل');

    // Failures are audited.
    const failures = await prisma.auditLog.count({ where: { action: 'auth.login.failed' } });
    expect(failures).toBe(maxAttempts);

    // Clear the lock so the remaining tests can authenticate as the cashier.
    await prisma.user.update({
      where: { username: 'cashier' },
      data: { lockedUntil: null, failedLoginAttempts: 0 },
    });
  });

  it('rejects a tampered or missing bearer token', async () => {
    const noToken = await request(testApp).get('/api/v1/auth/me');
    expect(noToken.status).toBe(401);

    const badToken = await request(testApp)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');
    expect(badToken.status).toBe(401);
    expect(badToken.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the current user and permissions for a valid token', async () => {
    const token = await tokenFor('PHARMACIST');
    const response = await request(testApp).get('/api/v1/auth/me').set(bearer(token));

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('PHARMACIST');
    expect(response.body.permissions).toContain('inventory:adjust');
    expect(response.body.permissions).not.toContain('users:manage');
  });

  it('enforces server-side authorisation regardless of the client UI', async () => {
    const cashier = await tokenFor('CASHIER');

    // Reading the catalogue is allowed…
    const read = await request(testApp).get('/api/v1/products').set(bearer(cashier));
    expect(read.status).toBe(200);

    // …but writing is not, even though the cashier holds a valid token.
    const write = await request(testApp)
      .post('/api/v1/products')
      .set(bearer(cashier))
      .send({ sku: 'NOPE-1', nameAr: 'صنف ممنوع', salePrice: '10.00' });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('FORBIDDEN');

    // Adjusting stock is likewise forbidden for a cashier.
    const adjust = await request(testApp)
      .post('/api/v1/inventory/adjustments')
      .set(bearer(cashier))
      .send({
        productId: 'any',
        warehouseId: 'any',
        type: 'ADJUSTMENT_IN',
        quantity: 1,
        reason: 'محاولة غير مصرح بها',
      });
    expect(adjust.status).toBe(403);
  });

  it('rotates the refresh token and invalidates the previous one', async () => {
    const first = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'pharmacist', password: TEST_PASSWORD });
    expect(first.status).toBe(200);

    const refreshed = await request(testApp)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(first.body.refreshToken);

    // The original token was revoked by the rotation.
    const replay = await request(testApp)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(replay.status).toBe(401);
  });

  it('revokes the session on logout', async () => {
    const login = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'accountant', password: TEST_PASSWORD });
    const token: string = login.body.accessToken;

    const before = await request(testApp).get('/api/v1/auth/me').set(bearer(token));
    expect(before.status).toBe(200);

    const logout = await request(testApp).post('/api/v1/auth/logout').set(bearer(token));
    expect(logout.status).toBe(204);

    const after = await request(testApp).get('/api/v1/auth/me').set(bearer(token));
    expect(after.status).toBe(401);
  });

  it('changes the password and revokes other sessions', async () => {
    const login = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'manager', password: TEST_PASSWORD });
    const token: string = login.body.accessToken;

    const weak = await request(testApp)
      .post('/api/v1/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'abcdefgh' });
    expect(weak.status).toBe(400);

    const wrongCurrent = await request(testApp)
      .post('/api/v1/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: 'NotThePassword1', newPassword: 'BrandNew123' });
    expect(wrongCurrent.status).toBe(400);

    const changed = await request(testApp)
      .post('/api/v1/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'BrandNew123' });
    expect(changed.status).toBe(204);

    const oldPassword = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'manager', password: TEST_PASSWORD });
    expect(oldPassword.status).toBe(401);

    const newPassword = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'manager', password: 'BrandNew123' });
    expect(newPassword.status).toBe(200);

    // Restore the fixture password for any later test.
    await request(testApp)
      .post('/api/v1/auth/change-password')
      .set(bearer(newPassword.body.accessToken))
      .send({ currentPassword: 'BrandNew123', newPassword: TEST_PASSWORD });
  });
});
