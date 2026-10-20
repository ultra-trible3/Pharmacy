import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { UnauthenticatedError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { asyncHandler } from '../lib/asyncHandler.js';

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

/**
 * Verifies the bearer access token AND that the backing session is still live,
 * then binds the fresh user record (role, active flag) to the request.
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearer(req);
  if (!token) throw new UnauthenticatedError();

  const payload = verifyAccessToken(token);

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw new UnauthenticatedError('انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول');
  }
  if (!session.user.isActive) {
    throw new UnauthenticatedError('الحساب غير مُفعّل');
  }
  if (session.user.id !== payload.sub) {
    throw new UnauthenticatedError('رمز دخول غير صالح');
  }

  req.user = {
    id: session.user.id,
    username: session.user.username,
    fullName: session.user.fullName,
    role: session.user.role,
    sessionId: session.id,
  };

  next();
});
