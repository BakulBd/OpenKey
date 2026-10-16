import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_GUIDE } from '@openkey/devices';
import { VIA_BOARDS } from '@openkey/devices/via-index';
import {
  modelGuideMarkdown,
  researchInventoryMarkdown,
} from '../../tools/guide-docs/src/render.js';
import { ROOT } from '../helpers.js';

/** Prettier pads table cells and dashes; compare the content only. */
const normal = (md: string) =>
  md
    .split('\n')
    .map((l) =>
      l.startsWith('|')
        ? l
            .split(/(?<!\\)\|/)
            .map((c) => c.trim().replace(/^-+$/, '---'))
            .join('|')
        : l,
    )
    .join('\n')
    .trim();

describe('generated documents', () => {
  for (const [file, render] of [
    ['docs/MODEL_GUIDE.md', modelGuideMarkdown],
    ['docs/RESEARCH_INVENTORY.md', researchInventoryMarkdown],
  ] as const)
    it(`${file} matches the device data (run pnpm docs:guide)`, () => {
      expect(normal(readFileSync(path.join(ROOT, file), 'utf8'))).toBe(normal(render()));
    });
});

describe('research sources and the VIA index', () => {
  it('cites repositories as owner/name with a licence field', () => {
    for (const e of MODEL_GUIDE)
      for (const s of e.sources ?? []) {
        expect(s.repo, `${e.brand} ${e.model}`).toMatch(/^[\w.-]+\/[\w.-]+$/);
        expect(s.license === null || /^[\w.-]+$/.test(s.license)).toBe(true);
      }
  });

  it('indexes about two thousand VIA boards with unique, well-formed identities', () => {
    expect(VIA_BOARDS.length).toBeGreaterThan(1500);
    for (const b of VIA_BOARDS) expect(b.id).toMatch(/^[0-9A-F]{4}:[0-9A-F]{4}$/);
    expect(new Set(VIA_BOARDS.map((b) => b.id)).size).toBe(VIA_BOARDS.length);
  });
});
