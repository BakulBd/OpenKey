import type { EffectCatalog, EffectDescriptor, Rgb } from '@openkey/core';
import { Channel } from './constants.js';
import type { LightingChannel } from './constants.js';

/**
 * Effect names per lighting channel, in QMK's enum order. As in the VIA app, the names assume every
 * effect is compiled into the firmware; a board built with fewer effects numbers them differently,
 * which is why the effect number is always shown next to the name.
 */
const RGB_MATRIX_EFFECTS = [
  'All off',
  'Solid colour',
  'Alphas/mods',
  'Gradient up/down',
  'Gradient left/right',
  'Breathing',
  'Band saturation',
  'Band value',
  'Pinwheel saturation',
  'Pinwheel value',
  'Spiral saturation',
  'Spiral value',
  'Cycle all',
  'Cycle left/right',
  'Cycle up/down',
  'Rainbow moving chevron',
  'Cycle out/in',
  'Cycle out/in dual',
  'Cycle pinwheel',
  'Cycle spiral',
  'Dual beacon',
  'Rainbow beacon',
  'Rainbow pinwheels',
  'Raindrops',
  'Jellybean raindrops',
  'Hue breathing',
  'Hue pendulum',
  'Hue wave',
  'Pixel rain',
  'Pixel flow',
  'Pixel fractal',
  'Typing heatmap',
  'Digital rain',
  'Solid reactive simple',
  'Solid reactive',
  'Solid reactive wide',
  'Solid reactive multi-wide',
  'Solid reactive cross',
  'Solid reactive multi-cross',
  'Solid reactive nexus',
  'Solid reactive multi-nexus',
  'Splash',
  'Multi splash',
  'Solid splash',
  'Solid multi splash',
];

const RGBLIGHT_EFFECTS = [
  'All off',
  'Solid colour',
  ...[1, 2, 3, 4].map((n) => `Breathing ${n}`),
  ...[1, 2, 3].map((n) => `Rainbow mood ${n}`),
  ...[1, 2, 3, 4, 5, 6].map((n) => `Rainbow swirl ${n}`),
  ...[1, 2, 3, 4, 5, 6].map((n) => `Snake ${n}`),
  ...[1, 2, 3].map((n) => `Knight ${n}`),
  'Christmas',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `Gradient ${n}`),
  'RGB test',
  'Alternating',
  ...[1, 2, 3, 4, 5, 6].map((n) => `Twinkle ${n}`),
];

const LED_MATRIX_EFFECTS = [
  'All off',
  'Solid',
  'Alphas/mods',
  'Breathing',
  'Band',
  'Band pinwheel',
  'Band spiral',
  'Cycle left/right',
  'Cycle up/down',
  'Cycle out/in',
  'Dual beacon',
  'Solid reactive simple',
  'Solid reactive wide',
  'Solid reactive multi-wide',
  'Solid reactive cross',
  'Solid reactive multi-cross',
  'Solid reactive nexus',
  'Solid reactive multi-nexus',
  'Solid splash',
  'Solid multi splash',
  'Wave left/right',
  'Wave up/down',
];

export const CHANNEL_NAME: Record<LightingChannel, string> = {
  [Channel.BACKLIGHT]: 'QMK backlight',
  [Channel.RGBLIGHT]: 'QMK RGB light',
  [Channel.RGB_MATRIX]: 'QMK RGB matrix',
  [Channel.LED_MATRIX]: 'QMK LED matrix',
};

/** Whether a channel has a colour value (single-colour backlights and LED matrices do not). */
export const hasColor = (c: LightingChannel): boolean =>
  c === Channel.RGBLIGHT || c === Channel.RGB_MATRIX;
export const hasSpeed = (c: LightingChannel): boolean => c !== Channel.BACKLIGHT;

export function viaEffectCatalog(channel: LightingChannel): EffectCatalog {
  const names =
    channel === Channel.RGB_MATRIX
      ? RGB_MATRIX_EFFECTS
      : channel === Channel.RGBLIGHT
        ? RGBLIGHT_EFFECTS
        : channel === Channel.LED_MATRIX
          ? LED_MATRIX_EFFECTS
          : ['Steady', 'Breathing'];
  const effects: EffectDescriptor[] = names.map((name, id) => ({
    id,
    name: channel === Channel.BACKLIGHT ? name : `${id} · ${name}`,
    controls: {
      color: hasColor(channel) && id !== 0,
      colorful: false,
      brightness: id !== 0 || channel === Channel.BACKLIGHT,
      speed: hasSpeed(channel) && id > 1,
      direction: [],
    },
  }));
  return {
    effects,
    brightness: { min: 0, max: 255 },
    speed: { min: 0, max: 255 },
    ...(channel !== Channel.BACKLIGHT ? { offEffect: 0 } : {}),
  };
}

/** QMK hue/saturation (0–255) at full value → RGB. */
export function hsToRgb(h: number, s: number): Rgb {
  const hh = (h / 255) * 6;
  const i = Math.floor(hh) % 6;
  const f = hh - Math.floor(hh);
  const v = 255;
  const p = Math.round(v * (1 - s / 255));
  const q = Math.round(v * (1 - (f * s) / 255));
  const t = Math.round(v * (1 - ((1 - f) * s) / 255));
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i]!;
  return { r: r!, g: g!, b: b! };
}

/** RGB → QMK hue/saturation (the value channel is brightness, set separately). */
export function rgbToHs({ r, g, b }: Rgb): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : Math.round((d / max) * 255);
  if (d === 0) return [0, s];
  let h = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  h = (h / 6 + 1) % 1;
  return [Math.round(h * 255) % 256, s];
}
