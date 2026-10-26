import type { EffectCatalog, EffectDescriptor, SettingOption } from '@openkey/core';
import { AULA_LAYOUT, BY_TECH_LAYOUT } from './page.js';
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
  effects: 'aula-fw24' | 'rk-ledopt' | 'rk-web' | null;
  /** `rk-web`: the effect numbers RK's web driver offers for the model (0 = off). */
  webEffects?: readonly number[];
  /**
   * The model's OpenKey layout numbers keys and LEDs by the firmware's 6 × 21 matrix, so key maps
   * and per-key colours can be written (RK web driver: key matrix 0x83/0x03, colours 0x86/0x06).
   */
  matrix?: boolean;
  /**
   * RK's key table for the model (`pnpm rk-keys`, folder of RK's software): FN-layer factory
   * functions, and the keyboard picture when `layoutId` is `rk-keys`.
   */
  rkKeys?: string;
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
    // Older firmware generation (`Fw=1`): RK's web driver uses the same profile layout for its
    // other `Fw=1` BY Tech boards (M87, L75 …), see BY_TECH_LAYOUT.
    pageLayout: BY_TECH_LAYOUT,
    matrix: true,
    rkKeys: '015e',
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
    // Drawn from RK's web driver entry for 258A:01A2 (its factory tables number keys and LEDs by
    // the matrix). 258A:01AF, once listed here, is the RK S98 in RK's web driver.
    layoutId: 'rk-web',
    matrix: true,
    pageLayout: BY_TECH_LAYOUT,
    // RK web driver, M87 entry (`lightEffects`): effects 1–13, 17, per-key (18) and off (0).
    effects: 'rk-web',
    webEffects: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 0],
    // RK web driver: brightness 1–20 on screen, stored 0–19.
    brightnessMax: 19,
    productIds: [0x01a2, 0x01f5, 0x0276],
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

/** BY Tech effect numbers as RK's web driver names them (protocol `BeiYing`). */
export const BEIYING_EFFECT_NAMES: Readonly<Record<number, string>> = {
  0: 'Off',
  1: 'Fixed on',
  2: 'Breathing',
  3: 'Rainbow',
  4: 'Flash away',
  5: 'Raindrops',
  6: 'Rainbow wheel',
  7: 'Ripples shining',
  8: 'Stars twinkle',
  9: 'Shadow disappear',
  10: 'Retro snake',
  11: 'Neon stream',
  12: 'Reaction',
  13: 'Sine wave',
  14: 'Side scan',
  15: 'Rotating windmill',
  16: 'Colorful waterfall',
  17: 'Blossoming',
  18: 'Custom (per-key colours)',
  19: 'Music',
};
export const SELF_DEFINE = 18;

/**
 * The effect positions an RK configuration lists, with the controls its `LedOpt` flags give each,
 * named as RK's web driver names the BY Tech effect numbers.
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
      name: `${BEIYING_EFFECT_NAMES[id] ?? `Effect ${id}`}${id === model.defaultEffect ? ' (default)' : ''}${off && !BEIYING_EFFECT_NAMES[id] ? ' (no controls)' : ''}`,
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

/** RK web driver effect lists: speed for every animated effect, colour for the plain ones. */
export function rkWebEffectCatalog(model: ByTechModel): EffectCatalog {
  const plain = new Set([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  return {
    effects: (model.webEffects ?? [])
      .filter((id) => id !== SELF_DEFINE)
      .map((id) => ({
        id,
        name: BEIYING_EFFECT_NAMES[id] ?? `Effect ${id}`,
        controls: {
          color: plain.has(id),
          colorful: plain.has(id),
          brightness: id !== 0,
          speed: id !== 0 && id !== 1,
          direction: [],
        },
      })),
    brightness: { min: 0, max: model.brightnessMax },
    // RK web driver: speed 1–4, stored as shown.
    speed: { min: 1, max: 4 },
    offEffect: 0,
  };
}

export function effectCatalog(model: ByTechModel): EffectCatalog {
  if (model.effects === 'rk-ledopt') return rkEffectCatalog(model);
  if (model.effects === 'rk-web') return rkWebEffectCatalog(model);
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
