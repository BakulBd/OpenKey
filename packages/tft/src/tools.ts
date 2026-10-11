import { createImage, fitImage } from './image.js';
import type { RgbaImage } from './image.js';
import type { AnimationFrame } from './gif.js';

/**
 * Animation tools for the screen studio: playback speed, loop style and photo slideshows. Pure
 * functions over frames; the upload pipeline (prepareAnimation) still enforces the panel's frame and
 * delay limits afterwards.
 */
export type LoopStyle = 'normal' | 'reverse' | 'boomerang';

/** Plays `speed` times faster (2 = twice as fast). Still images (delay 0) stay still. */
export function retime(frames: readonly AnimationFrame[], speed: number): AnimationFrame[] {
  if (!(speed > 0)) throw new RangeError('speed must be positive');
  return frames.map((f) => (f.delayMs === 0 ? f : { ...f, delayMs: Math.max(1, Math.round(f.delayMs / speed)) }));
}

/** Reverse plays backwards; boomerang plays forwards then backwards without repeating the ends. */
export function applyLoop(frames: readonly AnimationFrame[], style: LoopStyle): AnimationFrame[] {
  if (style === 'normal' || frames.length < 2) return [...frames];
  const back = [...frames].reverse();
  return style === 'reverse' ? back : [...frames, ...back.slice(1, -1)];
}

function blend(a: RgbaImage, b: RgbaImage, k: number): RgbaImage {
  const out = createImage(a.width, a.height);
  for (let i = 0; i < a.data.length; i++) out.data[i] = Math.round(a.data[i]! * (1 - k) + b.data[i]! * k);
  return out;
}

export interface SlideshowOptions {
  /** How long each photo stays, in ms. */
  holdMs?: number;
  /** Crossfade steps between photos (0 = hard cut). */
  fadeFrames?: number;
  fadeMs?: number;
}

/** Photos → one looping animation with crossfades, each photo cropped to fill the panel. */
export function slideshow(images: readonly RgbaImage[], width: number, height: number, opts: SlideshowOptions = {}): AnimationFrame[] {
  const hold = opts.holdMs ?? 1500;
  const steps = opts.fadeFrames ?? 6;
  const fadeMs = opts.fadeMs ?? 60;
  if (images.length === 0) return [];
  const fitted = images.map((img) => fitImage(img, width, height, 'cover'));
  if (fitted.length === 1) return [{ image: fitted[0]!, delayMs: 0 }];
  const out: AnimationFrame[] = [];
  fitted.forEach((img, i) => {
    out.push({ image: img, delayMs: hold });
    const next = fitted[(i + 1) % fitted.length]!;
    for (let s = 1; s <= steps; s++) out.push({ image: blend(img, next, s / (steps + 1)), delayMs: fadeMs });
  });
  return out;
}
