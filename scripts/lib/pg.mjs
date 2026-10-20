/**
 * Shared facts and helpers for the project-local PostgreSQL instance.
 *
 * Both `pg-dev.mjs` (lifecycle) and `setup.mjs` (one-command bootstrap) need to
 * find the same binaries, port and credential file, so that knowledge lives here
 * rather than being duplicated.
 *
 * Configuration (env overrides):
 *   PG_DEV_PORT       listening port of the local instance   (default 55432)
 *   PG_DEV_USER       superuser created by initdb            (default pharmacy_admin)
 *   PG_DEV_DATA_DIR   data directory                         (default .dev/pgdata)
 *   PG_DEV_BIN_DIR    explicit PostgreSQL bin directory      (auto-detected)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (this file lives in `scripts/lib/`). */
export const ROOT = resolve(__dirname, '..', '..');

export const PORT = process.env.PG_DEV_PORT ?? '55432';
export const USER = process.env.PG_DEV_USER ?? 'pharmacy_admin';
export const DATA_DIR = resolve(ROOT, process.env.PG_DEV_DATA_DIR ?? join('.dev', 'pgdata'));
export const DEV_DIR = resolve(ROOT, '.dev');
export const PW_FILE = join(DEV_DIR, 'pgpw.txt');
export const LOG_FILE = join(DEV_DIR, 'pg.log');

/** The databases the application and its integration tests expect to exist. */
export const DATABASES = ['pharmacy', 'pharmacy_test'];

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Locate the PostgreSQL binaries, preferring the newest local installation. */
export function resolveBinDir() {
  if (process.env.PG_DEV_BIN_DIR) return process.env.PG_DEV_BIN_DIR;

  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    if (existsSync(base)) {
      const versions = readdirSyncSafe(base)
        .filter((v) => /^\d+/.test(v))
        .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
      for (const v of versions) {
        const bin = join(base, v, 'bin');
        if (existsSync(join(bin, 'pg_ctl.exe'))) return bin;
      }
    }
    return null;
  }
  // Fall back to PATH on POSIX systems.
  return '';
}

export const BIN_DIR = resolveBinDir();

/** Absolute path to a PostgreSQL executable. */
export function exe(name) {
  return BIN_DIR ? join(BIN_DIR, process.platform === 'win32' ? `${name}.exe` : name) : name;
}

export function fail(message) {
  console.error(`\n[pg] ${message}\n`);
  process.exit(1);
}

export function ensureBinaries() {
  if (!BIN_DIR) {
    fail('PostgreSQL binaries were not found. Install PostgreSQL or set PG_DEV_BIN_DIR.');
  }
}

/** The generated superuser password, or `null` before the cluster is created. */
export function readPassword() {
  return existsSync(PW_FILE) ? readFileSync(PW_FILE, 'utf8').trim() : null;
}

/** Connection URL for a database on the local cluster. */
export function connectionString(database, password = readPassword() ?? '') {
  return `postgresql://${USER}:${encodeURIComponent(password)}@127.0.0.1:${PORT}/${database}?schema=public`;
}
