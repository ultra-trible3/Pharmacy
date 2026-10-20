import jwt from 'jsonwebtoken';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Role } from '@pharmacy/shared';
import { env } from '../env.js';
import { UnauthenticatedError } from './errors.js';

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: Role;
  /** Session id, so tokens can be revoked with the session. */
  sid: string;
}

export function signAccessToken(payload: AccessTokenPayload): {
  token: string;
  expiresIn: number;
} {
  const token = jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'pharmacy-pos',
    audience: 'pharmacy-pos-client',
  });
  return { token, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'pharmacy-pos',
      audience: 'pharmacy-pos-client',
    });
    if (typeof decoded === 'string') throw new Error('unexpected payload');
    const { sub, username, role, sid } = decoded as jwt.JwtPayload & AccessTokenPayload;
    if (!sub || !sid || !role) throw new Error('incomplete payload');
    return { sub, username: username ?? '', role, sid };
  } catch (error) {
    throw new UnauthenticatedError(
      error instanceof jwt.TokenExpiredError ? 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول' : 'رمز دخول غير صالح',
    );
  }
}

/** Opaque, high-entropy refresh token. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Tokens are stored as SHA-256 digests so a DB leak cannot be replayed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for hex digests of equal length. */
export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
