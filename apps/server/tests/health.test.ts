import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnect, testApp } from './helpers.js';

describe('health & documentation endpoints', () => {
  beforeAll(async () => {
    // The database is already migrated, so `readyz` must report ready.
  });

  afterAll(async () => {
    await disconnect();
  });

  it('GET /healthz reports the process as alive', async () => {
    const response = await request(testApp).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'pharmacy-api' });
    expect(typeof response.body.uptimeSeconds).toBe('number');
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('GET /readyz reports the database as reachable', async () => {
    const response = await request(testApp).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.checks.database.ok).toBe(true);
    expect(response.body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/openapi.json exposes a machine-readable contract', async () => {
    const response = await request(testApp).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toMatch(/^3\./u);
    expect(response.body.info?.title).toBeTruthy();
    expect(Object.keys(response.body.paths ?? {}).length).toBeGreaterThan(0);
  });

  it('GET /api/docs serves a self-contained HTML page (no CDN)', async () => {
    const response = await request(testApp).get('/api/docs');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('<!doctype html>');
    expect(response.text).not.toMatch(/https?:\/\/cdn\./u);
  });

  it('unknown routes return a structured 404 envelope', async () => {
    const response = await request(testApp).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });
});
