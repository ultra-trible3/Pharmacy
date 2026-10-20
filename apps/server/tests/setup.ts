/**
 * Vitest global setup for the API integration suite.
 *
 * This file is imported BEFORE any test module, so the environment is fully
 * overridden before `src/env.ts` reads it:
 *
 *  - `DATABASE_URL` is repointed at the dedicated `pharmacy_test` database,
 *  - `NODE_ENV=test` disables dev-only shortcuts,
 *  - logging is silenced so failures stay readable.
 *
 * `dotenv` never overrides variables that already exist, so setting them here
 * wins over `apps/server/.env`.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(packageRoot, '.env');
if (existsSync(envFile)) {
  loadDotenv({ path: envFile });
}

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pharmacy_admin:8tqdi9fhbl4r35ky2vwxz60o@127.0.0.1:55432/pharmacy_test?schema=public';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'test-secret-5a1c3e7b9d2f4a6c8e0b1d3f5a7c9e2b';
// A high default so the throttling test can drive its own counter predictably.
process.env.MAX_LOGIN_ATTEMPTS = process.env.MAX_LOGIN_ATTEMPTS ?? '5';
process.env.LOGIN_LOCK_MINUTES = process.env.LOGIN_LOCK_MINUTES ?? '15';
