import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Emits sw.js with the list of build files to precache and a build id derived from their names, so
 * every deployment produces a byte-different worker and browsers notice the update.
 */
/** Files copied from public/ (not part of the Rollup bundle). */
const PUBLIC_FILES = ['./manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

function serviceWorker(): Plugin {
  return {
    name: 'openkey-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      // Everything is precached (the whole app is a few hundred kB) so every page works offline.
      const precache = ['./', './index.html', ...PUBLIC_FILES, ...files.map((f) => `./${f}`)];
      const id = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__BUILD_ID__', id).replace('__PRECACHE__', JSON.stringify([...new Set(precache)])),
      });
    },
  };
}

// WebHID needs a secure context: http://localhost in development, HTTPS in production.
export default defineConfig({
  plugins: [react(), serviceWorker()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: 'localhost', port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
