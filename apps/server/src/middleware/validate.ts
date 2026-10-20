import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ValidationError } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function formatZodError(error: ZodError, source: Source) {
  return error.issues.map((issue) => ({
    field: [source, ...issue.path].join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Parses and replaces `req.body` / `req.query` / `req.params` with the
 * validated (and coerced) output of the given Zod schemas.
 *
 * `req.query` is re-assigned via `Object.defineProperty` because Express 4
 * exposes it as a getter in some deployments.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as Request['params'];
      }
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const source: Source = schemas.body ? 'body' : schemas.query ? 'query' : 'params';
        next(new ValidationError('بيانات غير صحيحة', formatZodError(error, source)));
        return;
      }
      next(error);
    }
  };
}
