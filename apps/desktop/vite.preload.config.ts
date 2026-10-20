import { defineConfig } from 'vite';

// Preload bundle — runs with contextIsolation enabled and must stay tiny.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron'],
    },
  },
});
