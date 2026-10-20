/**
 * Applies all committed Prisma migrations to the TEST database.
 *
 * `prisma migrate deploy` reads `DATABASE_URL`, so this script loads `.env`,
 * swaps in `TEST_DATABASE_URL` and then spawns Prisma with the overridden
 * environment. That keeps the production/dev database untouched while the
 * integration suite truncates tables freely.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(packageRoot, '.env');

if (existsSync(envFile)) {
  loadDotenv({ path: envFile });
}

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error(
    '[migrate-test] TEST_DATABASE_URL is not set. Add it to apps/server/.env (see .env.example).',
  );
  process.exit(1);
}

console.log('[migrate-test] applying migrations to the test database...');

const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'prisma', 'migrate', 'deploy'],
  {
    cwd: packageRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test' },
    shell: process.platform === 'win32',
  },
);

process.exit(result.status ?? 1);
