import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

// Renderer bundle. Forge's Vite plugin sets `root` and the output directory.
//
// NOTE: do not set `server.headers['Content-Type']` here. That header is applied
// to EVERY dev-server response, including transformed `.tsx`/`.js` modules and
// `@vite/client`, which makes Chromium reject them ("Expected a JavaScript
// module script but the server responded with a MIME type of text/html") and the
// window renders blank. Vite already serves HTML as UTF-8, so Arabic is fine.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src', 'renderer'),
    },
  },
  server: {
    // Workspace packages are served from their built `dist` with a stable `?v=`
    // hash, and Vite marks those responses immutable for a year. Rebuilding
    // @pharmacy/shared can therefore leave Electron on an old export list
    // ("does not provide an export named ...") and blank the window. Dev
    // modules must always be revalidated.
    headers: { 'Cache-Control': 'no-store' },
  },
  optimizeDeps: {
    // `@pharmacy/shared` is a linked workspace package whose surface grows as
    // the domain model evolves. Pre-bundling caches its export list under a
    // content hash, so adding an export leaves the dev server serving a stale
    // bundle ("does not provide an export named ...") and the window goes blank.
    // Serving it unbundled keeps the dev server honest; production builds are
    // unaffected (this option only applies to the dev server).
    exclude: ['@pharmacy/shared'],
  },
});
