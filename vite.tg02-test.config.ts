import { defineConfig } from 'vite';
export default defineConfig({ optimizeDeps: { entries: ['tests/tg02-flow-harness.html'] }, server: { host: '127.0.0.1', port: 14232, strictPort: true } });
