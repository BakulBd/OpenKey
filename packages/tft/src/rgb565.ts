import type { RgbaImage } from './image.js';

/** ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3) */
export function pack565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

export function unpack565(v: number): [number, number, number] {
  const r = (v >> 11) & 0x1f;
  const g = (v >> 5) & 0x3f;
  const b = v & 0x1f;
  // Replicate high bits into low bits so white maps back to 255.
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/**
 * Converts RGBA to RGB565 little endian (low byte first), the device pixel format confirmed by
 * aks075-linux USB captures and the official driver's GetImageRGB565Data path.
 */
export function toRgb565le(img: RgbaImage, opts: { dither?: boolean } = {}): Uint8Array {
  const { width, height } = img;
  const out = new Uint8Array(width * height * 2);
  if (!opts.dither) {
    for (let i = 0; i < width * height; i++) {
      const v = pack565(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!);
      out[i * 2] = v & 0xff;
      out[i * 2 + 1] = v >> 8;
    }
    return out;
  }
  // Floyd–Steinberg error diffusion in float space.
  const buf = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++)
    for (let c = 0; c < 3; c++) buf[i * 3 + c] = img.data[i * 4 + c]!;
  const spread = (x: number, y: number, err: number[], f: number): void => {
    if (x < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 3;
    for (let c = 0; c < 3; c++) buf[o + c]! += err[c]! * f;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      const r = Math.max(0, Math.min(255, Math.round(buf[o]!)));
      const g = Math.max(0, Math.min(255, Math.round(buf[o + 1]!)));
      const b = Math.max(0, Math.min(255, Math.round(buf[o + 2]!)));
      const v = pack565(r, g, b);
      const [qr, qg, qb] = unpack565(v);
      const err = [buf[o]! - qr, buf[o + 1]! - qg, buf[o + 2]! - qb];
      spread(x + 1, y, err, 7 / 16);
      spread(x - 1, y + 1, err, 3 / 16);
      spread(x, y + 1, err, 5 / 16);
      spread(x + 1, y + 1, err, 1 / 16);
      const i = y * width + x;
      out[i * 2] = v & 0xff;
      out[i * 2 + 1] = v >> 8;
    }
  }
  return out;
}

/** For previews: shows exactly what the panel will display. */
export function fromRgb565le(pixels: Uint8Array, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = unpack565(pixels[i * 2]! | (pixels[i * 2 + 1]! << 8));
    data.set([r, g, b, 255], i * 4);
  }
  return { width, height, data };
}
