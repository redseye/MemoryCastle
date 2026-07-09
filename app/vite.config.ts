import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// M5 web UI (plan §6). Dev server proxies /api to the locally running
// memorycastle API (M3/M4); MEMORYCASTLE_PORT lets both processes agree on
// a port without hardcoding one. Build output lands in dist/public so M6
// can serve it as static files alongside the API from a single process.
const apiPort = process.env.MEMORYCASTLE_PORT ?? '7420';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
