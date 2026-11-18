import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// TrueBatch Tablets Packing's web UI: packing/web with the shared screens of web/src and its pictures.
export default defineConfig({
  root: fileURLToPath(new URL('web', import.meta.url)),
  publicDir: fileURLToPath(new URL('../web/public', import.meta.url)),
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('../dist/packing-web', import.meta.url)), emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://localhost:3001' } },
});
