import { TftUploadError } from '@openkey/core';
import type { TftFrame } from '@openkey/core';
import { DATA_CHUNK_SIZE, TFT_DELAY_UNIT_MS, TFT_HEADER_BYTES } from '../constants.js';

/**
 * TFT animation payload (FUN_00422980):
 *   256-byte header filled with 0xFF; [0] = frame count; [1+i] = max(1, delay_i / 2) (2 ms units, 8 bit)
 *   followed by frames (width × height × 2 bytes RGB565, little endian, row-major),
 *   padded with 0xFF to whole 4096-byte chunks.
 */
export function encodeDelay(ms: number): number {
  const units = Math.trunc(ms / TFT_DELAY_UNIT_MS);
  return units > 1 ? Math.min(255, units) : 1;
}

export interface TftPlan {
  frames: number;
  chunks: number;
  header: Uint8Array;
}

export function planTftUpload(frames: TftFrame[], width: number, height: number, maxFrames: number): TftPlan {
  if (frames.length === 0) throw new TftUploadError('No frames to upload');
  const frameBytes = width * height * 2;
  const n = Math.min(frames.length, maxFrames, 255);
  for (const f of frames.slice(0, n)) {
    if (f.pixels.length !== frameBytes) throw new TftUploadError(`Frame must be ${frameBytes} bytes (got ${f.pixels.length})`);
  }
  const header = new Uint8Array(TFT_HEADER_BYTES).fill(0xff);
  header[0] = n;
  for (let i = 0; i < n; i++) header[1 + i] = encodeDelay(frames[i]!.delayMs);
  return { frames: n, chunks: Math.ceil((TFT_HEADER_BYTES + n * frameBytes) / DATA_CHUNK_SIZE), header };
}

/**
 * Yields the 4096-byte chunks one at a time (header, frames, 0xFF padding) so a 255-frame
 * animation never needs an 8 MB contiguous buffer.
 */
export function* tftChunks(frames: TftFrame[], plan: TftPlan): Generator<Uint8Array> {
  const frameBytes = frames[0]!.pixels.length;
  const total = TFT_HEADER_BYTES + plan.frames * frameBytes;
  const read = (pos: number): number => {
    if (pos < TFT_HEADER_BYTES) return plan.header[pos]!;
    if (pos >= total) return 0xff;
    const off = pos - TFT_HEADER_BYTES;
    return frames[Math.floor(off / frameBytes)]!.pixels[off % frameBytes]!;
  };
  for (let c = 0; c < plan.chunks; c++) {
    const chunk = new Uint8Array(DATA_CHUNK_SIZE);
    const base = c * DATA_CHUNK_SIZE;
    let i = 0;
    // Fast path: copy contiguous runs from a single source.
    while (i < DATA_CHUNK_SIZE) {
      const pos = base + i;
      if (pos >= TFT_HEADER_BYTES && pos < total) {
        const off = pos - TFT_HEADER_BYTES;
        const f = Math.floor(off / frameBytes);
        const within = off % frameBytes;
        const n = Math.min(DATA_CHUNK_SIZE - i, frameBytes - within);
        chunk.set(frames[f]!.pixels.subarray(within, within + n), i);
        i += n;
      } else {
        chunk[i] = read(pos);
        i++;
      }
    }
    yield chunk;
  }
}

/** Whole payload in one buffer (tests and small uploads). */
export function buildTftPayload(frames: TftFrame[], width: number, height: number, maxFrames: number): { payload: Uint8Array; chunks: number; frames: number } {
  const plan = planTftUpload(frames, width, height, maxFrames);
  const payload = new Uint8Array(plan.chunks * DATA_CHUNK_SIZE);
  let i = 0;
  for (const c of tftChunks(frames, plan)) payload.set(c, i++ * DATA_CHUNK_SIZE);
  return { payload, chunks: plan.chunks, frames: plan.frames };
}
