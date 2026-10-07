/** Platform-neutral RGBA image (straight alpha, 8 bits per channel, row-major). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export type FitMode = 'cover' | 'contain' | 'stretch';

export function createImage(
  width: number,
  height: number,
  fill: [number, number, number, number] = [0, 0, 0, 255],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
}

/**
 * Scales `src` into a `width`×`height` canvas with bilinear sampling.
 * cover: fill and crop the centre; contain: letterbox on `background`; stretch: ignore aspect.
 */
export function fitImage(
  src: RgbaImage,
  width: number,
  height: number,
  mode: FitMode = 'cover',
  background: [number, number, number] = [0, 0, 0],
  offset: { x: number; y: number } = { x: 0.5, y: 0.5 },
): RgbaImage {
  const out = createImage(width, height, [...background, 255]);
  let sw = src.width;
  let sh = src.height;
  let sx0 = 0;
  let sy0 = 0;
  let dw = width;
  let dh = height;
  let dx0 = 0;
  let dy0 = 0;
  const srcAspect = src.width / src.height;
  const dstAspect = width / height;
  if (mode === 'cover') {
    if (srcAspect > dstAspect) {
      sw = src.height * dstAspect;
      sx0 = (src.width - sw) * offset.x;
    } else {
      sh = src.width / dstAspect;
      sy0 = (src.height - sh) * offset.y;
    }
  } else if (mode === 'contain') {
    if (srcAspect > dstAspect) {
      dh = width / srcAspect;
      dy0 = (height - dh) / 2;
    } else {
      dw = height * srcAspect;
      dx0 = (width - dw) / 2;
    }
  }
  const sample = (x: number, y: number, c: number): number => {
    const xi = Math.min(src.width - 1, Math.max(0, x));
    const yi = Math.min(src.height - 1, Math.max(0, y));
    return src.data[(yi * src.width + xi) * 4 + c]!;
  };
  for (let y = 0; y < height; y++) {
    if (y < Math.floor(dy0) || y >= Math.ceil(dy0 + dh)) continue;
    for (let x = 0; x < width; x++) {
      if (x < Math.floor(dx0) || x >= Math.ceil(dx0 + dw)) continue;
      const fx = sx0 + ((x - dx0 + 0.5) / dw) * sw - 0.5;
      const fy = sy0 + ((y - dy0 + 0.5) / dh) * sh - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const o = (y * width + x) * 4;
      const alpha =
        (sample(x0, y0, 3) * (1 - ax) + sample(x0 + 1, y0, 3) * ax) * (1 - ay) +
        (sample(x0, y0 + 1, 3) * (1 - ax) + sample(x0 + 1, y0 + 1, 3) * ax) * ay;
      for (let c = 0; c < 3; c++) {
        const v =
          (sample(x0, y0, c) * (1 - ax) + sample(x0 + 1, y0, c) * ax) * (1 - ay) +
          (sample(x0, y0 + 1, c) * (1 - ax) + sample(x0 + 1, y0 + 1, c) * ax) * ay;
        // Composite over the background colour.
        out.data[o + c] = Math.round((v * alpha + background[c]! * (255 - alpha)) / 255);
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}
