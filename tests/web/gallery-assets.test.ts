import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GALLERY_CATEGORIES, decodeGif } from '@openkey/tft';
import { PUBLIC_GIFS } from '../../apps/web/src/features/tft/public-gifs.js';
import { ROOT } from '../helpers.js';

const dir = path.join(ROOT, 'apps/web/public/gallery');
const credits = readFileSync(path.join(ROOT, 'THIRD_PARTY.md'), 'utf8');

describe('public-domain gallery GIFs', () => {
  it('ships exactly the listed files', () => {
    expect(readdirSync(dir).sort()).toEqual(PUBLIC_GIFS.map((g) => g.file).sort());
  });

  for (const g of PUBLIC_GIFS)
    it(`${g.file}: free licence, credited, within the screen budget`, () => {
      expect(['Public domain', 'CC0']).toContain(g.license);
      expect(g.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(GALLERY_CATEGORIES).toContain(g.category);
      expect(credits).toContain(g.file);
      const file = path.join(dir, g.file);
      expect(statSync(file).size).toBeLessThan(600 * 1024);
      const frames = decodeGif(new Uint8Array(readFileSync(file)));
      expect(frames).toHaveLength(g.frames);
      expect(frames.length).toBeLessThanOrEqual(48);
      expect(frames[0]!.image.width).toBeLessThanOrEqual(128);
    });
});
