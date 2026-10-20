#!/usr/bin/env node
/**
 * Project-local PostgreSQL control script.
 *
 * Manages an isolated PostgreSQL data directory that lives inside the repository
 * (`.dev/pgdata`). It never touches the pre-existing Windows PostgreSQL services,
 * which keeps development reproducible and the host machine clean.
 *
 * Usage:
 *   node scripts/pg-dev.mjs start|stop|status|init
 *
 * Configuration (env overrides):
 *   PG_DEV_PORT       listening port of the local instance   (default 55432)
 *   PG_DEV_USER       superuser created by initdb            (default pharmacy_admin)
 *   PG_DEV_DATA_DIR   data directory                         (default .dev/pgdata)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  DATA_DIR,
  DEV_DIR,
  LOG_FILE,
  PORT,
  PW_FILE,
  USER,
  ensureBinaries,
  exe,
  fail,
} from './lib/pg.mjs';

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', ...options });
}

function capture(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function isRunning() {
  const res = capture(exe('pg_ctl'), ['-D', DATA_DIR, 'status']);
  return res.status === 0;
}

function init() {
  ensureBinaries();
  if (existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log(`[pg-dev] data directory already initialised at ${DATA_DIR}`);
    return;
  }

  mkdirSync(DEV_DIR, { recursive: true });
  if (!existsSync(PW_FILE)) {
    writeFileSync(PW_FILE, randomBytes(18).toString('base64url'), { encoding: 'ascii' });
    console.log(`[pg-dev] generated superuser password -> ${PW_FILE}`);
  }

  console.log(`[pg-dev] initialising cluster at ${DATA_DIR}`);
  const res = run(exe('initdb'), [
    '-D',
    DATA_DIR,
    '-U',
    USER,
    `--pwfile=${PW_FILE}`,
    '--encoding=UTF8',
    '--locale=C',
    '-A',
    'scram-sha-256',
  ]);
  if (res.status !== 0) fail('initdb failed');

  appendFileSync(
    join(DATA_DIR, 'postgresql.conf'),
    [
      '',
      '# --- pharmacy management system: project-local dev instance ---',
      `port = ${PORT}`,
      "listen_addresses = 'localhost'",
      'password_encryption = scram-sha-256',
      'max_connections = 100',
      '',
    ].join('\n'),
  );
  console.log('[pg-dev] cluster initialised');
}

function start() {
  ensureBinaries();
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) init();
  if (isRunning()) {
    console.log(`[pg-dev] already running on port ${PORT}`);
    return;
  }
  console.log(`[pg-dev] starting PostgreSQL on port ${PORT}`);
  const res = run(exe('pg_ctl'), ['-D', DATA_DIR, '-l', LOG_FILE, '-w', '-t', '60', 'start']);
  if (res.status !== 0) fail(`failed to start. See ${LOG_FILE}`);
  console.log(`[pg-dev] ready -> postgresql://${USER}@127.0.0.1:${PORT}/pharmacy`);
}

function stop() {
  ensureBinaries();
  if (!isRunning()) {
    console.log('[pg-dev] not running');
    return;
  }
  console.log('[pg-dev] stopping PostgreSQL');
  run(exe('pg_ctl'), ['-D', DATA_DIR, '-m', 'fast', '-w', 'stop']);
}

function status() {
  ensureBinaries();
  const running = isRunning();
  console.log(`[pg-dev] data directory: ${DATA_DIR}`);
  console.log(`[pg-dev] port:           ${PORT}`);
  console.log(`[pg-dev] status:         ${running ? 'RUNNING' : 'STOPPED'}`);
  if (running && existsSync(PW_FILE)) {
    const pw = readFileSync(PW_FILE, 'utf8');
    console.log(`[pg-dev] connection:     postgresql://${USER}:${pw}@127.0.0.1:${PORT}/pharmacy`);
  }
  if (existsSync(LOG_FILE)) {
    console.log(`[pg-dev] log:            ${LOG_FILE}`);
  }
}

const action = process.argv[2] ?? 'status';
const actions = { init, start, stop, status };
if (!actions[action]) fail(`unknown action "${action}". Use: init | start | stop | status`);
actions[action]();
