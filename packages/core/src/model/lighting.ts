export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The four flat directions every lighting protocol with a direction knows. */
export type PlaneDirection = 'left' | 'right' | 'up' | 'down';
/** Plus the rotating and radial directions some firmwares offer (Winbond MK870 and siblings). */
export type Direction = PlaneDirection | 'clockwise' | 'anticlockwise' | 'inwards' | 'outwards';

export const PLANE_DIRECTIONS: readonly PlaneDirection[] = ['left', 'right', 'up', 'down'];

/** The direction as one of the four flat ones; others fall back to `fallback`. */
export function planeDirection(d: Direction, fallback: PlaneDirection = 'left'): PlaneDirection {
  return (PLANE_DIRECTIONS as readonly string[]).includes(d) ? (d as PlaneDirection) : fallback;
}

/** Global lighting effect configuration. Field ranges come from the active effect catalog. */
export interface RgbConfig {
  effect: number;
  color: Rgb;
  /** "Colourful"/rainbow flag – the effect cycles colours instead of using `color`. */
  colorful: boolean;
  /** Second colour, for effects that blend two (see `controls.color2`). */
  color2?: Rgb;
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
    /** The effect also uses a second colour. */
    color2?: boolean;
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

/**
 * A lighting zone that is not a key and takes one colour for the whole zone (a knob ring, side
 * light bars …). The colour is the only thing OpenKey changes; the zone's other settings stay.
 */
export interface LightZone {
  id: string;
  name: string;
  color: Rgb;
}

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
