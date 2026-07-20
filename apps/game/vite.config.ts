import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
) as { version: string };

export default defineConfig({
  plugins: [react()],
  // Shown in the menu footer + Support dialog so beta reports can name a build.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
