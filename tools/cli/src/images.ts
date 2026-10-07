import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { decodeGif, pattern, redBlueAnimation } from '@openkey/tft';
import type { AnimationFrame, PatternName } from '@openkey/tft';

/** Loads `pattern:<name>`, `pattern:red-blue`, or a PNG/JPEG/GIF file as animation frames. */
export async function loadFrames(
  source: string,
  width: number,
  height: number,
  stillDelayMs = 0,
): Promise<AnimationFrame[]> {
  if (source.startsWith('pattern:')) {
    const name = source.slice('pattern:'.length);
    if (name === 'red-blue') return redBlueAnimation(width, height);
    return [{ image: pattern(name as PatternName, width, height), delayMs: stillDelayMs }];
  }
  const bytes = new Uint8Array(await fs.readFile(source));
  const ext = path.extname(source).toLowerCase();
  if (ext === '.gif' || (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46))
    return decodeGif(bytes);
  if (ext === '.png' || bytes[0] === 0x89) {
    const png = PNG.sync.read(Buffer.from(bytes));
    return [
      {
        image: { width: png.width, height: png.height, data: new Uint8Array(png.data) },
        delayMs: stillDelayMs,
      },
    ];
  }
  if (ext === '.jpg' || ext === '.jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8)) {
    const j = jpeg.decode(bytes, { useTArray: true });
    return [{ image: { width: j.width, height: j.height, data: j.data }, delayMs: stillDelayMs }];
  }
  throw new Error(`Unsupported image format: ${source} (PNG, JPEG, GIF or pattern:<name>)`);
}

export async function savePng(
  file: string,
  rgba: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
): Promise<void> {
  const png = new PNG({ width: rgba.width, height: rgba.height });
  png.data = Buffer.from(rgba.data);
  await fs.writeFile(file, PNG.sync.write(png));
}
