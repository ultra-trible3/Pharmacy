import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES } from '@pharmacy/shared';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Dependency-free fixed-window rate limiter.
 *
 * Deliberately in-process: the deployment target is a single LAN server, so a
 * distributed store is unnecessary. Keys combine the client IP with a bucket
 * name so different routes can have independent budgets.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  name: string;
  message?: string;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, name } = options;

  // Opportunistic cleanup so the map cannot grow unbounded.
  const sweep = () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };
  const sweeper = setInterval(sweep, Math.max(windowMs, 30_000));
  sweeper.unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${name}:${ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('x-ratelimit-remaining', String(max - 1));
      next();
      return;
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('retry-after', String(retryAfterSeconds));
      res.setHeader('x-ratelimit-remaining', '0');
      res.status(429).json({
        error: {
          code: ERROR_CODES.RATE_LIMITED,
          message: options.message ?? 'عدد المحاولات كبير جدًا، حاول لاحقًا',
          details: { retryAfterSeconds },
          requestId: req.requestId,
        },
      });
      return;
    }

    bucket.count += 1;
    res.setHeader('x-ratelimit-remaining', String(Math.max(0, max - bucket.count)));
    next();
  };
}
