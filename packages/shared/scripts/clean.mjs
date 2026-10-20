import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
rmSync(join(packageRoot, 'dist'), { recursive: true, force: true });
console.log('[shared] removed dist');
