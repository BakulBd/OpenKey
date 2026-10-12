import { describe, expect, it } from 'vitest';
import { applyLoop, createImage, retime, slideshow } from '@openkey/tft';
import type { AnimationFrame } from '@openkey/tft';

const frames = (n: number, ms = 100): AnimationFrame[] =>
  Array.from({ length: n }, (_, i) => ({
    image: createImage(2, 2, [i * 10, 0, 0, 255]),
    delayMs: ms,
  }));

describe('screen animation tools', () => {
  it('changes speed without freezing still images', () => {
    expect(retime(frames(3, 100), 2).map((f) => f.delayMs)).toEqual([50, 50, 50]);
    expect(retime([{ image: createImage(1, 1), delayMs: 0 }], 2)[0]!.delayMs).toBe(0);
    expect(() => retime(frames(1), 0)).toThrow();
  });

  it('reverses and boomerangs without repeating the end frames', () => {
    const red = (fs: AnimationFrame[]) => fs.map((f) => f.image.data[0]);
    expect(red(applyLoop(frames(4), 'reverse'))).toEqual([30, 20, 10, 0]);
    expect(red(applyLoop(frames(4), 'boomerang'))).toEqual([0, 10, 20, 30, 20, 10]);
  });

  it('builds a looping crossfade slideshow at panel size', () => {
    const black = createImage(10, 6, [0, 0, 0, 255]);
    const white = createImage(4, 8, [255, 255, 255, 255]);
    const s = slideshow([black, white], 8, 8, { holdMs: 1000, fadeFrames: 3, fadeMs: 50 });
    expect(s).toHaveLength(8);
    expect(s.every((f) => f.image.width === 8 && f.image.height === 8)).toBe(true);
    expect(s[0]!.delayMs).toBe(1000);
    const mid = s[2]!.image.data[0]!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(255);
  });
});
