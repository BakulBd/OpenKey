import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  globalHeaders,
  headersFile,
  nginxSecurityHeaders,
  toSplatPattern,
} from '../../tools/deploy/src/headers.js';
import type { HeaderRule } from '../../tools/deploy/src/headers.js';
import { ROOT } from '../helpers.js';

const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
  headers: HeaderRule[];
};

describe('one set of security headers on every host', () => {
  it('the nginx snippet is exactly what vercel.json generates', () => {
    const snippet = readFileSync(path.join(ROOT, 'deploy/nginx/security-headers.conf'), 'utf8');
    expect(
      snippet
        .split('\n')
        .filter((l) => l && !l.startsWith('#'))
        .join('\n'),
    ).toBe(nginxSecurityHeaders(vercel.headers));
  });

  it('every nginx location includes the security headers', () => {
    const conf = readFileSync(path.join(ROOT, 'deploy/nginx/default.conf'), 'utf8');
    const locations = conf.split(/\n\s*location /).slice(1);
    const serving = locations.filter((l) => !/return 404/.test(l.split('}')[0]!));
    expect(serving.length).toBeGreaterThanOrEqual(5);
    for (const l of serving)
      expect(l.split('}')[0]).toMatch(/include \/etc\/nginx\/snippets\/security-headers\.conf/);
  });

  it('the _headers file (Netlify, Cloudflare Pages) carries every rule', () => {
    const f = headersFile(vercel.headers);
    for (const r of vercel.headers) {
      expect(f).toContain(toSplatPattern(r.source));
      for (const h of r.headers) expect(f).toContain(`${h.key}: ${h.value}`);
    }
  });

  it('keeps WebHID allowed for the site itself and the strict CSP', () => {
    const g = Object.fromEntries(globalHeaders(vercel.headers).map((h) => [h.key, h.value]));
    expect(g['Permissions-Policy']).toMatch(/hid=\(self\)/);
    expect(g['Content-Security-Policy']).toMatch(/script-src 'self'/);
    expect(g['Content-Security-Policy']).not.toMatch(/unsafe-eval|unsafe-inline/);
  });

  it('ships the Docker image definition with an unprivileged server', () => {
    expect(existsSync(path.join(ROOT, 'Dockerfile'))).toBe(true);
    expect(readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')).toMatch(/nginx-unprivileged/);
  });
});

describe('the free Vercel (Hobby) plan is enough', () => {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as Record<
    string,
    unknown
  >;

  it('deploys as static files: no serverless functions, middleware, crons or image optimisation', () => {
    for (const key of ['functions', 'crons', 'images', 'rewrites', 'redirects'])
      expect(config[key], key).toBeUndefined();
    for (const dir of ['api', 'apps/web/api', 'middleware.ts', 'apps/web/middleware.ts'])
      expect(existsSync(path.join(ROOT, dir)), dir).toBe(false);
    expect(config.outputDirectory).toBe('apps/web/dist');
  });

  it('keeps the bundled media small (the gallery ships with the site)', () => {
    const dir = path.join(ROOT, 'apps/web/public');
    const size = (p: string): number =>
      statSync(p).isDirectory()
        ? readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0)
        : statSync(p).size;
    expect(size(dir)).toBeLessThan(8 * 1024 * 1024);
  });
});
