import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing using OWASP-recommended parameters
 * (19 MiB memory, 2 iterations, parallelism 1, 32-byte output).
 *
 * `@node-rs/argon2` declares `Algorithm` as an ambient `const enum`, which
 * cannot be dereferenced while `isolatedModules` is enabled, so the numeric
 * discriminant for Argon2id (2) is used directly.
 */
const ARGON2_OPTIONS = {
  algorithm: 2, // Algorithm.Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/** Constant-time-ish verification; returns false instead of throwing on bad input. */
export async function verifyPassword(plain: string, digest: string): Promise<boolean> {
  try {
    return await verify(digest, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A lazily-computed dummy digest used to equalise the response timing of
 * "user not found" and "wrong password", mitigating username enumeration.
 */
let dummyHashPromise: Promise<string> | null = null;

export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-equalisation-000');
  return dummyHashPromise;
}
