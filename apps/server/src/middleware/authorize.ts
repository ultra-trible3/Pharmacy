import type { NextFunction, Request, Response } from 'express';
import { hasPermission, type Permission } from '@pharmacy/shared';
import { ForbiddenError, UnauthenticatedError } from '../lib/errors.js';

/**
 * Requires a valid access token. The user is re-loaded from the database on
 * every request so that role changes, deactivation and session revocation take
 * effect immediately — permissions are never trusted from the token alone.
 */
export function authorize(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      next(new UnauthenticatedError());
      return;
    }
    const missing = required.filter((permission) => !hasPermission(user.role, permission));
    if (missing.length > 0) {
      req.log.warn({ userId: user.id, role: user.role, missing }, 'permission denied');
      next(new ForbiddenError(`صلاحيات ناقصة: ${missing.join(', ')}`));
      return;
    }
    next();
  };
}
