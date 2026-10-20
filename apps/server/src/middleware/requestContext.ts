import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';

/** Attaches a correlation id and a child logger to every request. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const headerId = req.header('x-request-id');
  req.requestId = headerId && headerId.length <= 64 ? headerId : randomUUID();
  req.log = logger.child({ requestId: req.requestId });
  res.setHeader('x-request-id', req.requestId);
  next();
}

/** Minimal structured access log (no body, no secrets). */
export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level](
      {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.user?.id,
      },
      'request',
    );
  });
  next();
}
