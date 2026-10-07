import { decompressFrames, parseGIF } from 'gifuct-js';
import type { RgbaImage } from './image.js';

export interface AnimationFrame {
  image: RgbaImage;
  delayMs: number;
}

/** Default delay for GIF frames that declare 0 (browsers use ~100 ms). */
export const DEFAULT_GIF_DELAY_MS = 100;

/**
 * Decodes an animated GIF into fully composited RGBA frames, honouring frame disposal so each
 * output frame is what a browser would show at that moment.
 */
export function decodeGif(bytes: Uint8Array): AnimationFrame[] {
  const gif = parseGIF(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const frames = decompressFrames(gif, true);
  const width = gif.lsd.width;
  const height = gif.lsd.height;
  const canvas = new Uint8ClampedArray(width * height * 4);
  const out: AnimationFrame[] = [];
  let previous: Uint8ClampedArray | null = null;
  for (const f of frames) {
    if (f.disposalType === 3) previous = canvas.slice();
    const { left, top, width: fw, height: fh } = f.dims;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const s = (y * fw + x) * 4;
        if (f.patch[s + 3] === 0) continue;
        const dx = left + x;
        const dy = top + y;
        if (dx >= width || dy >= height) continue;
        canvas.set(f.patch.subarray(s, s + 4), (dy * width + dx) * 4);
      }
    }
    out.push({
      image: { width, height, data: canvas.slice() },
      delayMs: f.delay || DEFAULT_GIF_DELAY_MS,
    });
    if (f.disposalType === 2) {
      for (let y = 0; y < fh; y++)
        canvas.fill(0, ((top + y) * width + left) * 4, ((top + y) * width + left + fw) * 4);
    } else if (f.disposalType === 3 && previous) {
      canvas.set(previous);
    }
  }
  return out;
}

/** Evenly drops frames to fit `max`, summing the delays of dropped frames into the kept ones. */
export function decimateFrames(frames: AnimationFrame[], max: number): AnimationFrame[] {
  if (frames.length <= max) return frames;
  const out: AnimationFrame[] = [];
  const step = frames.length / max;
  for (let i = 0; i < max; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    const delay = frames.slice(start, end).reduce((s, f) => s + f.delayMs, 0);
    out.push({ image: frames[start]!.image, delayMs: delay });
  }
  return out;
}
