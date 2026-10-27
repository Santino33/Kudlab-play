import { defineConfig } from 'vite';
export default defineConfig({
  optimizeDeps: { entries: ['index.html'] },
  server: { fs: { strict: true, allow: ['src', 'public', 'node_modules', 'index.html'] } },
  build: { sourcemap: false, assetsInlineLimit: 0 },
});
