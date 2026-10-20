#!/usr/bin/env node
/**
 * One-command developer bootstrap: `pnpm setup`.
 *
 * Idempotent — safe to re-run at any time. It will:
 *   1. verify Node.js and installed dependencies,
 *   2. start the project-local PostgreSQL cluster (creating it if needed),
 *   3. create the `pharmacy` and `pharmacy_test` databases,
 *   4. generate `apps/server/.env` with the real DB password and a fresh JWT
 *      secret (never overwriting an existing file),
 *   5. apply migrations to both databases and load the demo seed.
 *
 * It does NOT install packages: run `pnpm install` first.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATABASES, PORT, PW_FILE, ROOT, USER, exe, ensureBinaries, fail } from './lib/pg.mjs';

const SERVER_DIR = join(ROOT, 'apps', 'server');
const ENV_FILE = join(SERVER_DIR, '.env');
const ENV_EXAMPLE = join(SERVER_DIR, '.env.example');

const MIN_NODE = { major: 20, minor: 11 };
const JWT_PLACEHOLDER = '"change-me-to-a-long-random-string-at-least-32-chars"';

function step(message) {
  console.log(`\n\u25b8 ${message}`);
}

function ok(message) {
  console.log(`  \u2713 ${message}`);
}

/**
 * Resolve how to invoke pnpm without going through Node's own shell handling.
 *
 * `shell: true` is needed for pnpm's `.cmd` shim on Windows, but Node deprecates
 * passing arguments to a shell (they are concatenated, not escaped). Instead:
 *   - under `pnpm bootstrap`, `npm_execpath` points at pnpm's JavaScript entry
 *     point, so we invoke it through `node` directly;
 *   - otherwise on Windows we hand a single, already-assembled command line to
 *     `cmd.exe`, which is the supported way to run a `.cmd` shim.
 */
function pnpmInvocation(args) {
  const execpath = process.env.npm_execpath;
  if (execpath && /\.(cjs|mjs|js)$/iu.test(execpath) && existsSync(execpath)) {
    return { command: process.execPath, args: [execpath, ...args] };
  }
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', ['pnpm', ...args].join(' ')] };
  }
  return { command: 'pnpm', args };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', cwd: ROOT, ...options });
}

function capture(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', cwd: ROOT, ...options });
}

function checkNode() {
  step('Checking Node.js');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor)) {
    fail(`Node.js ${MIN_NODE.major}.${MIN_NODE.minor}+ is required (found ${process.versions.node}).`);
  }
  ok(`Node.js ${process.versions.node}`);

  if (!existsSync(join(ROOT, 'node_modules'))) {
    fail('Dependencies are not installed. Run `pnpm install` first.');
  }
  ok('dependencies installed');
}

function startDatabase() {
  step('Starting the project-local PostgreSQL cluster');
  const res = run(process.execPath, [join(ROOT, 'scripts', 'pg-dev.mjs'), 'start'], { shell: false });
  if (res.status !== 0) fail('Could not start PostgreSQL. See .dev/pg.log for details.');
  ok(`listening on 127.0.0.1:${PORT}`);
}

/** Runs psql against the maintenance database with the generated password. */
function psql(args) {
  ensureBinaries();
  if (!existsSync(PW_FILE)) fail(`Missing database password file: ${PW_FILE}`);
  const password = readFileSync(PW_FILE, 'utf8').trim();
  return capture(
    exe('psql'),
    ['-h', '127.0.0.1', '-p', PORT, '-U', USER, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args],
    { env: { ...process.env, PGPASSWORD: password }, shell: false },
  );
}

function ensureDatabases() {
  step('Ensuring application databases exist');
  for (const name of DATABASES) {
    const exists = psql(['-tAc', `SELECT 1 FROM pg_database WHERE datname = '${name}'`]);
    if (exists.status !== 0) {
      fail(`psql failed while checking "${name}": ${(exists.stderr ?? '').trim()}`);
    }
    if (exists.stdout.trim() === '1') {
      ok(`${name} (already present)`);
      continue;
    }
    const created = psql(['-c', `CREATE DATABASE "${name}"`]);
    if (created.status !== 0) {
      fail(`Could not create database "${name}": ${(created.stderr ?? '').trim()}`);
    }
    ok(`${name} (created)`);
  }
}

function ensureEnvFile() {
  step('Preparing apps/server/.env');
  if (existsSync(ENV_FILE)) {
    ok('.env already exists (left untouched)');
    return;
  }
  if (!existsSync(ENV_EXAMPLE)) fail(`Missing template: ${ENV_EXAMPLE}`);

  const password = readFileSync(PW_FILE, 'utf8').trim();
  const jwtSecret = randomBytes(48).toString('base64url');
  const rendered = readFileSync(ENV_EXAMPLE, 'utf8')
    .replaceAll('CHANGE_ME', encodeURIComponent(password))
    .replace(JWT_PLACEHOLDER, `"${jwtSecret}"`);

  writeFileSync(ENV_FILE, rendered);
  ok('generated .env with the local DB password and a random JWT secret');
}

function pnpm(args, label) {
  step(label);
  const { command, args: cmdArgs } = pnpmInvocation(args);
  const res = run(command, cmdArgs);
  if (res.status !== 0) fail(`\`pnpm ${args.join(' ')}\` failed.`);
  ok(label);
}

function main() {
  console.log('Pharmacy Management System \u2014 developer setup');

  checkNode();
  startDatabase();
  ensureDatabases();
  ensureEnvFile();

  pnpm(['--filter', '@pharmacy/server', 'db:deploy'], 'Applying migrations to pharmacy');
  pnpm(['--filter', '@pharmacy/server', 'db:migrate:test'], 'Applying migrations to pharmacy_test');
  pnpm(['--filter', '@pharmacy/server', 'db:seed'], 'Loading demo data');

  console.log('\n\u2705 Setup complete.\n');
  console.log('  Start everything:      pnpm dev');
  console.log('  API only:              pnpm dev:server');
  console.log('  API docs:              http://127.0.0.1:4000/api/docs');
  console.log('  Run all tests:         pnpm test');
  console.log('\n  Demo logins (password Pharma@2024): owner, manager, pharmacist,');
  console.log('  cashier, inventory, accountant');
}

main();
