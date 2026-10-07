export type PixelFormat = 'rgb565le';

export interface TftInfo {
  width: number;
  height: number;
  pixelFormat: PixelFormat;
  maxFrames: number;
  /** User animation slots exposed by the firmware. */
  slots: number;
  /** Per-frame delay quantisation. */
  delayUnitMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  /** Size in bytes of one transfer chunk. */
  chunkBytes: number;
}

/** A display-ready frame in the device pixel format. */
export interface TftFrame {
  pixels: Uint8Array;
  delayMs: number;
}

export interface UploadProgress {
  phase: 'prepare' | 'transfer' | 'commit' | 'done';
  sent: number;
  total: number;
}

export type ProgressCallback = (p: UploadProgress) => void;
