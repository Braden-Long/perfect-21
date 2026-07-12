import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same build works from file:// in Electron.
  base: './',
  server: {
    // API lives in apps/server during development.
    proxy: { '/api': 'http://localhost:8721' },
  },
  resolve: {
    alias: {
      '@perfect21/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
    },
  },
});
