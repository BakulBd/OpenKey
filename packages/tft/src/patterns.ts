import { createImage } from './image.js';
import type { RgbaImage } from './image.js';
import type { AnimationFrame } from './gif.js';

/** Controlled test assets from docs/reverse-engineering/capture-methodology.md. */
export type PatternName =
  'red' | 'green' | 'blue' | 'white' | 'black' | 'checkerboard' | 'gradient' | 'quadrants';

export function solid(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  return createImage(width, height, [...rgb, 255]);
}

export function checkerboard(width: number, height: number, cell = 8): RgbaImage {
  const img = createImage(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 255 : 0;
      img.data.set([v, v, v, 255], (y * width + x) * 4);
    }
  return img;
}

/** Red increases left→right, green top→bottom, blue diagonally: reveals channel/byte-order errors. */
export function gradient(width: number, height: number): RgbaImage {
  const img = createImage(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      img.data.set(
        [
          Math.round((x / (width - 1)) * 255),
          Math.round((y / (height - 1)) * 255),
          Math.round(((x + y) / (width + height - 2)) * 255),
          255,
        ],
        (y * width + x) * 4,
      );
    }
  return img;
}

/** Red/green/blue/white quadrants: reveals row/column stride and orientation errors. */
export function quadrants(width: number, height: number): RgbaImage {
  const img = createImage(width, height);
  const colors: [number, number, number][] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const q = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1);
      img.data.set([...colors[q]!, 255], (y * width + x) * 4);
    }
  return img;
}

export function pattern(name: PatternName, width: number, height: number): RgbaImage {
  switch (name) {
    case 'red':
      return solid(width, height, [255, 0, 0]);
    case 'green':
      return solid(width, height, [0, 255, 0]);
    case 'blue':
      return solid(width, height, [0, 0, 255]);
    case 'white':
      return solid(width, height, [255, 255, 255]);
    case 'black':
      return solid(width, height, [0, 0, 0]);
    case 'checkerboard':
      return checkerboard(width, height);
    case 'gradient':
      return gradient(width, height);
    case 'quadrants':
      return quadrants(width, height);
  }
}

/** Two-frame red/blue animation (capture experiment 14). */
export function redBlueAnimation(width: number, height: number, delayMs = 500): AnimationFrame[] {
  return [
    { image: solid(width, height, [255, 0, 0]), delayMs },
    { image: solid(width, height, [0, 0, 255]), delayMs },
  ];
}
