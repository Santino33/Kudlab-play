import { defineConfig } from 'vite';
import { simulator } from './tests/simulator/plugin';
export default defineConfig({
  optimizeDeps: { entries: ['index.html', 'tests/simulator/host.ts'] },
  plugins: [simulator()],
  define: { 'import.meta.env.VITE_API_ORIGIN': JSON.stringify(`http://127.0.0.1:${process.env.KUDLAB_DEMO_PORT ?? 4173}`),
    'import.meta.env.VITE_TEACHER_ORIGIN': JSON.stringify(`http://localhost:${process.env.KUDLAB_DEMO_PORT ?? 4173}`) },
  server: { host: '127.0.0.1', fs: { strict: true, allow: ['src', 'tests/simulator', 'node_modules', 'index.html'] } },
});
