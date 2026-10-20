import { Router } from 'express';
import { checkDatabase } from '../../prisma.js';
import { env } from '../../env.js';

export const healthRouter = Router();

const startedAt = Date.now();

/** Liveness: the process is up. */
healthRouter.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'pharmacy-api',
    version: process.env.npm_package_version ?? '0.1.0',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

/** Readiness: dependencies (database) are reachable. */
healthRouter.get('/readyz', async (_req, res) => {
  const db = await checkDatabase();
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ready' : 'degraded',
    checks: {
      database: { ok: db.ok, latencyMs: db.latencyMs, ...(db.error ? { error: db.error } : {}) },
    },
    timestamp: new Date().toISOString(),
  });
});
