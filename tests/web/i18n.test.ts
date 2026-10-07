import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../../apps/web/src/i18n/locales/en.js';
import { interpolate } from '../../apps/web/src/i18n/interpolate.js';
import { ROOT } from '../helpers.js';

const dir = path.join(ROOT, 'apps/web/src/i18n/locales');
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n catalogues', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'en.ts');

  it('ships the ten non-English locales', () => {
    expect(files.map((f) => f.replace('.ts', '')).sort()).toEqual(['bn', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh-CN', 'zh-TW']);
  });

  for (const f of files) {
    it(`${f}: every key exists in English and keeps its placeholders`, async () => {
      const m = (await import(path.join(dir, f))).default as Record<string, string>;
      for (const [k, v] of Object.entries(m)) {
        expect(en, `${f}: unknown key ${k}`).toHaveProperty([k]);
        expect(placeholders(v), `${f}: placeholders of ${k}`).toEqual(placeholders(en[k as keyof typeof en]));
        expect(v.trim(), `${f}: empty ${k}`).not.toBe('');
      }
    });
  }

  it('interpolates and leaves unknown placeholders visible', () => {
    expect(interpolate('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
  });
});
