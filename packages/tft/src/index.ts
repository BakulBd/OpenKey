import type { TftFrame, TftInfo } from '@openkey/core';
import { fitImage } from './image.js';
import type { FitMode, RgbaImage } from './image.js';
import { toRgb565le } from './rgb565.js';
import type { AnimationFrame } from './gif.js';
import { decimateFrames } from './gif.js';

export * from './image.js';
export * from './rgb565.js';
export * from './gif.js';
export * from './patterns.js';

export interface PrepareOptions {
  fit?: FitMode;
  dither?: boolean;
  background?: [number, number, number];
  offset?: { x: number; y: number };
}

/** Converts one image to a device frame. */
export function prepareFrame(
  img: RgbaImage,
  info: Pick<TftInfo, 'width' | 'height'>,
  delayMs = 0,
  opts: PrepareOptions = {},
): TftFrame {
  const fitted =
    img.width === info.width && img.height === info.height
      ? img
      : fitImage(
          img,
          info.width,
          info.height,
          opts.fit ?? 'cover',
          opts.background ?? [0, 0, 0],
          opts.offset,
        );
  return { pixels: toRgb565le(fitted, { dither: opts.dither ?? false }), delayMs };
}

/** Converts an animation, decimating to the device's frame limit and clamping delays. */
export function prepareAnimation(
  frames: AnimationFrame[],
  info: TftInfo,
  opts: PrepareOptions = {},
): { frames: TftFrame[]; dropped: number; clampedDelays: number } {
  const kept = decimateFrames(frames, info.maxFrames);
  let clamped = 0;
  const animated = kept.length > 1;
  const out = kept.map((f) => {
    // A still image has no frame timing; only animations are clamped and reported.
    const d = animated
      ? Math.min(info.maxDelayMs, Math.max(info.minDelayMs, f.delayMs))
      : f.delayMs;
    if (d !== f.delayMs) clamped++;
    return prepareFrame(f.image, info, d, opts);
  });
  return { frames: out, dropped: frames.length - kept.length, clampedDelays: clamped };
}
