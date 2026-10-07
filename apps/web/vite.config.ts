import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// WebHID needs a secure context: http://localhost in development, HTTPS in production.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: 'localhost', port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
