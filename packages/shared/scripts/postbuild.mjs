/**
 * Post-build step for the shared package.
 *
 * Writes `dist/cjs/package.json` so Node treats the CommonJS output as CJS even
 * though the package root declares `"type": "module"`. This gives the package a
 * genuine dual ESM/CJS build consumed by the API server (ESM), the Electron
 * main process (CJS) and the Vite renderer bundle (ESM).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cjsDir = join(packageRoot, 'dist', 'cjs');

mkdirSync(cjsDir, { recursive: true });
writeFileSync(join(cjsDir, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
console.log('[shared] wrote dist/cjs/package.json');
