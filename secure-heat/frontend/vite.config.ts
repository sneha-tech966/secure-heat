/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev server proxies /api to the backend so the session cookie is same-origin (SameSite=Strict works, no CORS needed).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.VITE_BACKEND_URL ?? 'http://localhost:4000', changeOrigin: false } } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./tests/setup.ts'], css: false },
});
