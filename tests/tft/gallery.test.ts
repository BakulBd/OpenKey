import { describe, expect, it } from 'vitest';
import type { TftInfo } from '@openkey/core';
import { createImage, GALLERY, prepareAnimation, renderGallery } from '@openkey/tft';

/** The AK820 MAX screen as its adapter reports it (sonix-feature getTftInfo). */
const AK820_TFT: TftInfo = { width: 128, height: 128, pixelFormat: 'rgb565le', maxFrames: 255, slots: 1, minDelayMs: 2, maxDelayMs: 510, delayUnitMs: 2, chunkBytes: 4096 };

function maxDiff(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

describe('screen animation gallery', () => {
  it('has unique ids and names', () => {
    expect(new Set(GALLERY.map((a) => a.id)).size).toBe(GALLERY.length);
    expect(GALLERY.length).toBeGreaterThanOrEqual(8);
  });

  for (const a of GALLERY) {
    it(`${a.id}: loops seamlessly, is deterministic and moves`, () => {
      const at = (t: number) => {
        const img = createImage(64, 64);
        a.paint(img, t);
        return img.data;
      };
      // Frame N (t = 1) wraps to frame 0 (t = 0): no jump at the loop point.
      expect(maxDiff(at(0), at(1))).toBeLessThanOrEqual(2);
      expect(maxDiff(at(0.3), at(0.3))).toBe(0);
      expect(maxDiff(at(0), at(0.25))).toBeGreaterThan(20);
    });

    it(`${a.id}: fits the AK820 screen limits and is not blank`, () => {
      const frames = renderGallery(a.id, 128, 128);
      expect(frames).toHaveLength(a.frames);
      const prepared = prepareAnimation(frames, AK820_TFT);
      expect(prepared.dropped).toBe(0);
      expect(prepared.clampedDelays).toBe(0);
      const lit = frames[0]!.image.data.filter((_, i) => i % 4 !== 3 && _ > 40).length;
      expect(lit).toBeGreaterThan(128 * 128 * 0.02);
    });
  }

  it('rejects an unknown animation', () => {
    expect(() => renderGallery('nope')).toThrow(/Unknown/);
  });
});
