import type { EffectCatalog, EffectDescriptor, SettingOption } from '@openkey/core';
import { AULA_LAYOUT } from './page.js';
import type { PageLayout } from './page.js';

/**
 * Models of the BY Tech OEM family, keyed by the six-byte identity the keyboard returns for
 * GET_INFO/1. The USB IDs say nothing about the model (every AULA board is 258A:010C), so this code
 * is what the vendor driver itself matches (`Psd=` in its profiles).
 */
export interface ByTechModel {
  /** Identity as lowercase hex, e.g. "03 00 00 00 00 cd". */
  identity: string;
  brand: string;
  model: string;
  /** OpenKey layout used for the keyboard picture. */
  layoutId: string;
  /**
   * Settings-page layout, when it is known for this firmware generation. `null` means OpenKey reads
   * the page but does not decode or write it until the layout is confirmed on this model.
   */
  pageLayout: PageLayout | null;
  /**
   * Lighting effects in firmware order (1-based position = the value stored in the page): the AULA
   * Fw=24 list, or the controls an RK driver configuration gives each position (`ledOpt`).
   */
  effects: 'aula-fw24' | 'rk-ledopt' | null;
  /**
   * RK `LedOptN=animation,speed,brightness,direction,random,colour` flags per effect position; null
   * for a position the configuration leaves out.
   */
  ledOpt?: readonly (readonly [number, number, number, number, number, number] | null)[];
  /** Effect the vendor configuration selects by default (`DefLedIndex`). */
  defaultEffect?: number;
  brightnessMax: number;
  /**
   * USB product IDs the identity is trusted on. RK's codes are generic (`a,0,0,0,0,0`), so an RK
   * entry is used only on the USB ID its code was published for.
   */
  productIds?: number[];
  /** The board has a screen whose clock is set with `SetScreenParam` (RK screen boards). */
  screenClock?: boolean;
  /** Where the identity and parameters come from. */
  source: string;
}

const LEISIJI = 'leisiji/AulaSofwareLinux (MIT) README model table and vendor profiles';
const fw24 = (
  identity: string,
  model: string,
  brightnessMax: number,
  layoutId: string,
): ByTechModel => ({
  identity,
  brand: 'AULA',
  model,
  layoutId,
  pageLayout: AULA_LAYOUT,
  effects: 'aula-fw24',
  brightnessMax,
  source: LEISIJI,
});

export const BY_TECH_MODELS: readonly ByTechModel[] = [
  fw24('03 00 00 00 00 cd', 'F75', 9, 'ak820-pro'),
  fw24('03 00 00 00 00 8f', 'F87', 4, 'ak820-pro'),
  fw24('03 00 00 00 01 0b', 'F87 PRO', 4, 'ak820-pro'),
  fw24('03 00 00 00 00 a9', 'F87 PRO Wired', 4, 'ak820-pro'),
  fw24('03 00 00 00 00 a4', 'F99', 4, 'ak820-pro'),
  fw24('03 00 00 00 01 58', 'F99 Pro', 4, 'ak820-pro'),
  fw24('03 00 00 00 00 9a', 'F99 Wired', 4, 'ak820-pro'),
  fw24('03 00 00 00 03 7c', 'H108', 4, 'ak820-pro'),
  {
    identity: '0a 00 00 00 00 00',
    brand: 'RK',
    model: 'R75 RGB (wired)',
    layoutId: 'rk-r75',
    // Older firmware generation (`Fw=1`): the AULA page layout is not confirmed for it.
    pageLayout: null,
    effects: 'rk-ledopt',
    // Dev/015E/KB.ini LedOpt1–LedOpt20 (LedOpt18 is absent), DefLedIndex=10.
    ledOpt: [
      [0, 0, 1, 0, 1, 1],
      [0, 1, 1, 0, 1, 1],
      [0, 1, 1, 0, 0, 0],
      ...Array.from({ length: 11 }, () => [0, 1, 1, 0, 1, 1] as const),
      [0, 1, 1, 0, 0, 0],
      [0, 1, 1, 0, 0, 0],
      [0, 1, 1, 0, 0, 0],
      null,
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
    defaultEffect: 10,
    brightnessMax: 5,
    productIds: [0x015e],
    source:
      'RK driver configuration for USB 258A:015E (Dev/015E/KB.ini: Psd=a,0,0,0,0,0, Fw=1, LedOpt, DefLedIndex, key table), as published by vinc3m1/kludgeknight (facts only)',
  },
  {
    identity: '06 00 00 00 00 23',
    brand: 'RK',
    model: 'M87 (screen)',
    layoutId: 'ak820-pro',
    pageLayout: null,
    effects: null,
    brightnessMax: 5,
    productIds: [0x01a2, 0x01af],
    screenClock: true,
    source:
      'RK driver configuration Dev/01AF/KB.ini (Psd=6,0,0,0,0,23; ShowScreen=1, siScreen=320,172) and the cable identity 258A:01A2, as published by ElXreno/rk-m87-sync (MIT)',
  },
];

export const identityHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

export function modelFor(identity: Uint8Array, productId?: number): ByTechModel | undefined {
  const hex = identityHex(identity);
  return BY_TECH_MODELS.find(
    (m) =>
      m.identity === hex &&
      (!m.productIds || (productId !== undefined && m.productIds.includes(productId))),
  );
}

/** `ui index, hw effect, speed, brightness, direction, random, colour` rows shared by every Fw=24 profile. */
const AULA_FW24_ROWS: readonly [number, string, number, number, number, number, number][] = [
  [1, 'Fixed on', 0, 1, 0, 1, 1],
  [2, 'Breathing', 1, 1, 0, 1, 1],
  [3, 'Rainbow', 1, 1, 0, 0, 0],
  [4, 'Flash away', 1, 1, 0, 1, 1],
  [5, 'Raindrops', 1, 1, 0, 1, 1],
  [6, 'Rainbow wheel', 1, 1, 0, 1, 1],
  [7, 'Ripples shining', 1, 1, 0, 1, 1],
  [8, 'Stars twinkle', 1, 1, 0, 1, 1],
  [9, 'Shadow disappear', 1, 1, 0, 1, 1],
  [10, 'Retro snake', 1, 1, 0, 1, 1],
  [11, 'Neon stream', 1, 1, 0, 1, 1],
  [12, 'Reaction', 1, 1, 0, 1, 1],
  [13, 'Sine wave', 1, 1, 0, 1, 1],
  [14, 'Retinue scanning', 1, 1, 0, 1, 1],
  [15, 'Rotating windmill', 1, 1, 0, 0, 0],
  [16, 'Colorful waterfall', 1, 1, 0, 0, 0],
  [17, 'Blossoming', 1, 1, 0, 0, 0],
  [18, 'Rotating storm', 1, 1, 0, 1, 1],
  [21, 'Off', 0, 0, 0, 0, 0],
];
export const AULA_OFF_EFFECT = 21;

/**
 * The effect positions an RK configuration lists, with the controls its `LedOpt` flags give each.
 * RK names the effects in a shared `led.xml` whose order does not match every board, so they are
 * numbered; a position with no control is the firmware's off/indicator slot.
 */
export function rkEffectCatalog(model: ByTechModel): EffectCatalog {
  const effects: EffectDescriptor[] = [];
  (model.ledOpt ?? []).forEach((flags, i) => {
    if (!flags) return;
    const [, speed, light, direction, random, color] = flags;
    const id = i + 1;
    const off = flags.every((f) => f === 0);
    effects.push({
      id,
      name: `Effect ${id}${id === model.defaultEffect ? ' (default)' : ''}${off ? ' (no controls)' : ''}`,
      controls: {
        color: !!color,
        colorful: !!random,
        brightness: !!light,
        speed: !!speed,
        direction: direction === 1 ? ['left', 'right'] : direction === 2 ? ['up', 'down'] : [],
      },
    });
  });
  return {
    effects,
    brightness: { min: 0, max: model.brightnessMax },
    speed: { min: 0, max: 4 },
  };
}

export function effectCatalog(model: ByTechModel): EffectCatalog {
  if (model.effects === 'rk-ledopt') return rkEffectCatalog(model);
  const effects: EffectDescriptor[] = AULA_FW24_ROWS.map(
    ([id, name, speed, light, , random, color]) => ({
      id,
      name,
      controls: {
        color: !!color,
        colorful: !!random,
        brightness: !!light,
        speed: !!speed,
        direction: [],
      },
    }),
  );
  return {
    effects,
    brightness: { min: 0, max: model.brightnessMax },
    speed: { min: 0, max: 4 },
    offEffect: AULA_OFF_EFFECT,
  };
}

/** `SleepUI` seconds and the `SleepHW` value stored in the page (every Fw=24 profile). */
export const AULA_SLEEP: readonly SettingOption[] = [
  [60, 2],
  [90, 3],
  [120, 4],
  [180, 6],
  [240, 8],
  [300, 10],
  [600, 20],
  [900, 30],
  [1200, 40],
].map(([s, hw]) => ({ value: hw!, label: s! % 60 === 0 ? `${s! / 60} min` : `${s! / 60} min` }));
