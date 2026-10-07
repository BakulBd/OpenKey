export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/** Global lighting effect configuration. Field ranges come from the active effect catalog. */
export interface RgbConfig {
  effect: number;
  color: Rgb;
  /** "Colourful"/rainbow flag – the effect cycles colours instead of using `color`. */
  colorful: boolean;
  brightness: number;
  speed: number;
  direction: Direction;
}

/** Which controls an effect honours. Lets the UI show only meaningful sliders. */
export interface EffectDescriptor {
  id: number;
  name: string;
  controls: {
    color: boolean;
    colorful: boolean;
    brightness: boolean;
    speed: boolean;
    direction: Direction[];
  };
}

export interface EffectCatalog {
  effects: EffectDescriptor[];
  brightness: { min: number; max: number };
  speed: { min: number; max: number };
  /** Effect id that turns the backlight off, if any. */
  offEffect?: number;
  /** Effect id that shows the per-key (custom) colour table. */
  customEffect?: number;
}

/** Per-key colours keyed by LED index. */
export type PerKeyRgb = Record<number, Rgb>;

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => (v & 0xff).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
