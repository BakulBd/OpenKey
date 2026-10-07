import { describe, expect, it } from 'vitest';
import { sonixFeature } from '@openkey/protocols';
import {
  checkerboard,
  fitImage,
  fromRgb565le,
  pack565,
  pattern,
  prepareAnimation,
  prepareFrame,
  redBlueAnimation,
  toRgb565le,
} from '@openkey/tft';
import type { TftInfo } from '@openkey/core';

const INFO: TftInfo = {
  width: 128,
  height: 128,
  pixelFormat: 'rgb565le',
  maxFrames: 255,
  slots: 1,
  delayUnitMs: 2,
  minDelayMs: 2,
  maxDelayMs: 510,
  chunkBytes: 4096,
};

describe('RGB565', () => {
  it('packs primaries little endian', () => {
    const px = (r: number, g: number, b: number) =>
      Array.from(toRgb565le({ width: 1, height: 1, data: Uint8Array.of(r, g, b, 255) }));
    expect(px(255, 0, 0)).toEqual([0x00, 0xf8]);
    expect(px(0, 255, 0)).toEqual([0xe0, 0x07]);
    expect(px(0, 0, 255)).toEqual([0x1f, 0x00]);
    expect(px(255, 255, 255)).toEqual([0xff, 0xff]);
    expect(pack565(0x12, 0x34, 0x56)).toBe(
      ((0x12 & 0xf8) << 8) | ((0x34 & 0xfc) << 3) | (0x56 >> 3),
    );
  });

  it('round-trips white and black exactly', () => {
    const img = fromRgb565le(Uint8Array.of(0xff, 0xff, 0, 0), 2, 1);
    expect(Array.from(img.data)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it('dithering keeps solid primaries unchanged', () => {
    const red = pattern('red', 8, 8);
    expect(toRgb565le(red, { dither: true })).toEqual(toRgb565le(red));
  });
});

describe('fitting', () => {
  it('covers by cropping the centre', () => {
    const src = checkerboard(256, 128, 64);
    const out = fitImage(src, 128, 128, 'cover');
    expect(out.width).toBe(128);
    expect(out.data[3]).toBe(255);
  });

  it('contains with letterboxing', () => {
    const src = pattern('white', 256, 128);
    const out = fitImage(src, 128, 128, 'contain', [0, 0, 0]);
    expect(Array.from(out.data.subarray(0, 4))).toEqual([0, 0, 0, 255]);
    const mid = (64 * 128 + 64) * 4;
    expect(Array.from(out.data.subarray(mid, mid + 4))).toEqual([255, 255, 255, 255]);
  });
});

describe('sonix-feature TFT payload', () => {
  it('single frame: 9 chunks, header 01 01 then 0xFF', () => {
    const f = prepareFrame(pattern('red', 128, 128), INFO);
    const { payload, chunks } = sonixFeature.buildTftPayload([f], 128, 128, 255);
    expect(chunks).toBe(9);
    expect(payload.length).toBe(9 * 4096);
    expect(Array.from(payload.subarray(0, 4))).toEqual([1, 1, 0xff, 0xff]);
    expect(Array.from(payload.subarray(256, 260))).toEqual([0x00, 0xf8, 0x00, 0xf8]);
    expect(payload[256 + 32768]).toBe(0xff);
  });

  it('two frames at 500 ms: header 02 fa fa, 17 chunks', () => {
    const { frames } = prepareAnimation(redBlueAnimation(128, 128, 500), INFO);
    const { payload, chunks } = sonixFeature.buildTftPayload(frames, 128, 128, 255);
    expect(chunks).toBe(17);
    expect(Array.from(payload.subarray(0, 4))).toEqual([2, 0xfa, 0xfa, 0xff]);
    expect(Array.from(payload.subarray(256 + 32768, 256 + 32770))).toEqual([0x1f, 0x00]);
  });

  it('encodes delays in 2 ms units with a minimum of 1', () => {
    expect(sonixFeature.encodeDelay(0)).toBe(1);
    expect(sonixFeature.encodeDelay(100)).toBe(50);
    expect(sonixFeature.encodeDelay(10_000)).toBe(255);
  });

  it('decimates animations above the frame limit', () => {
    const many = Array.from({ length: 300 }, () => ({
      image: pattern('black', 4, 4),
      delayMs: 20,
    }));
    const r = prepareAnimation(many, { ...INFO, width: 4, height: 4, maxFrames: 140 });
    expect(r.frames).toHaveLength(140);
    expect(r.dropped).toBe(160);
  });
});

describe('rotateImage', () => {
  it('rotates a 2×1 image a quarter turn clockwise into 1×2', async () => {
    const { createImage, rotateImage } = await import('@openkey/tft');
    const img = createImage(2, 1);
    img.data.set([255, 0, 0, 255, 0, 0, 255, 255]);
    const r = rotateImage(img, 1);
    expect([r.width, r.height]).toEqual([1, 2]);
    expect(Array.from(r.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    expect(Array.from(rotateImage(img, 2).data)).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
    expect(rotateImage(img, 4)).toBe(img);
  });
});
