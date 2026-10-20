import { defineConfig } from 'vite';

// Electron main-process bundle. Forge's Vite plugin injects the entry point,
// output directory and Electron externals; we only disable the Node built-in
// externalisation surprises for our bundled ESM workspace package.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron'],
    },
  },
});
