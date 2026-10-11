import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { headersFile } from '../../tools/deploy/src/headers.js';
import type { HeaderRule } from '../../tools/deploy/src/headers.js';

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

/**
 * Files served next to the app: the Linux udev rule and its installer (single source: udev/ in the
 * repository) and the `_headers` file for Netlify / Cloudflare Pages (generated from vercel.json).
 * The dev server serves the same files.
 */
const STATIC_EXTRAS: Record<string, { file: URL; type: string }> = {
  'linux/70-openkey.rules': { file: new URL('../../udev/70-openkey.rules', import.meta.url), type: 'text/plain; charset=utf-8' },
  'linux/install-openkey-udev.sh': { file: new URL('../../udev/install-openkey-udev.sh', import.meta.url), type: 'text/x-shellscript; charset=utf-8' },
};

function deployExtras(): Plugin {
  return {
    name: 'openkey-deploy-extras',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const extra = STATIC_EXTRAS[(req.url ?? '').replace(/^\//, '').split('?')[0]!];
        if (!extra) return next();
        res.setHeader('content-type', extra.type);
        res.end(readFileSync(extra.file));
      });
    },
    generateBundle() {
      for (const [fileName, { file }] of Object.entries(STATIC_EXTRAS)) this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
      const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as { headers: HeaderRule[] };
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(vercel.headers) });
    },
  };
}

/** Public URL of the deployment, for canonical links, social previews and the sitemap. */
const SITE_URL = (process.env.OPENKEY_SITE_URL ?? 'https://openkey-lovat.vercel.app').replace(/\/+$/, '');

/** Fills the site URL into index.html and emits robots.txt and sitemap.xml for it. */
function seo(): Plugin {
  return {
    name: 'openkey-seo',
    transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', SITE_URL),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n` });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`,
      });
    },
  };
}

// WebHID needs a secure context: http://localhost in development, HTTPS in production.
export default defineConfig({
  plugins: [react(), serviceWorker(), deployExtras(), seo()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: 'localhost', port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
