import type { KeyboardLayout, TransportMode } from '@openkey/core';
import maxPlus from '../../../devices/ak820-max-plus.json' with { type: 'json' };
import pro from '../../../devices/ak820-pro.json' with { type: 'json' };
import proOnline from '../../../devices/ak820-pro-online.json' with { type: 'json' };
import maxCrs from '../../../devices/ak820-max-crs.json' with { type: 'json' };
import dongle from '../../../devices/ak820-dongle.json' with { type: 'json' };
import proQmk from '../../../devices/ak820-pro-qmk.json' with { type: 'json' };
import f108Pro from '../../../devices/aula-f108-pro.json' with { type: 'json' };
import ak35i from '../../../devices/ajazz-ak35i-v3-max.json' with { type: 'json' };
import nova75 from '../../../devices/aula-nova75.json' with { type: 'json' };
import layoutMax from './layouts/ak820-max.json' with { type: 'json' };
import layoutPro from './layouts/ak820-pro.json' with { type: 'json' };
import layoutProOnline from './layouts/ak820-pro-online.json' with { type: 'json' };
import layoutNova75 from './layouts/aula-nova75.json' with { type: 'json' };
import layoutAk820Rgb from './layouts/ajazz-ak820-rgb.json' with { type: 'json' };
import { ansiLayout } from './layouts/ansi.js';

export type ConfigurationSupport = 'supported' | 'partial' | 'unsupported' | 'unknown';

export interface ModelProfile {
  id: string;
  model: string;
  notes?: string;
  vendorIds: string[];
  productIds: string[];
  productNames: string[];
  firmwareRange: { min: string | null; max: string | null; tested: string[] };
  usagePages: string[];
  usages: Record<string, string[]>;
  protocolFamily: string;
  variant: string;
  layout: string;
  transportModes: Record<
    Exclude<TransportMode, 'unknown'>,
    { configuration: ConfigurationSupport; evidence: string }
  >;
  tft: {
    width: number;
    height: number;
    maxFrames: number | null;
    slots: number;
    headerBytes: number;
    chunkBytes: number | null;
    delayUnitMs: number;
    /**
     * Upload framing. `max` (default): 256-byte header, IMAGE sub-command = slot, SAVE — verified on
     * the AK820 MAX. `pro`: AK820 Pro firmware as community tools describe it (see the ledger).
     */
    framing?: 'max' | 'pro';
  } | null;
  rgb: {
    brightnessMax: number;
    speedMax: number;
    defaultEffect: number | null;
    perKey: boolean;
  } | null;
  macros: { slots: number; storageBytes: number | null; eventBudgetBytes?: number } | null;
  knob: { configurable: boolean; note: string };
  evidence: string[];
}

export const PROFILES: readonly ModelProfile[] = [
  maxPlus,
  pro,
  proOnline,
  maxCrs,
  dongle,
  proQmk,
  f108Pro,
  ak35i,
  nova75,
] as unknown as ModelProfile[];

/** AULA F108 Pro key indices (= LED indices) from the vendor's rgb-keyboard.xml (parsiya/f108-pro key-map.md). */
const F108_PRO_KEYS: Record<string, number> = {
  Esc: 1,
  F1: 2,
  F2: 3,
  F3: 4,
  F4: 5,
  F5: 6,
  F6: 7,
  F7: 8,
  F8: 9,
  F9: 10,
  F10: 11,
  F11: 12,
  F12: 13,
  PrtSc: 112,
  ScrLk: 113,
  Pause: 115,
  '`': 19,
  '1': 20,
  '2': 21,
  '3': 22,
  '4': 23,
  '5': 24,
  '6': 25,
  '7': 26,
  '8': 27,
  '9': 28,
  '0': 29,
  '-': 30,
  '=': 31,
  Backspace: 103,
  Ins: 116,
  Home: 117,
  PgUp: 118,
  NumLock: 32,
  'KP/': 33,
  'KP*': 34,
  'KP-': 122,
  Tab: 37,
  Q: 38,
  W: 39,
  E: 40,
  R: 41,
  T: 42,
  Y: 43,
  U: 44,
  I: 45,
  O: 46,
  P: 47,
  '[': 48,
  ']': 49,
  '\\': 67,
  Del: 119,
  End: 120,
  PgDn: 121,
  KP7: 50,
  KP8: 51,
  KP9: 52,
  'KP+': 123,
  Caps: 55,
  A: 56,
  S: 57,
  D: 58,
  F: 59,
  G: 60,
  H: 61,
  J: 62,
  K: 63,
  L: 64,
  ';': 65,
  "'": 66,
  Enter: 85,
  KP4: 68,
  KP5: 69,
  KP6: 70,
  LShift: 73,
  Z: 74,
  X: 75,
  C: 76,
  V: 77,
  B: 78,
  N: 79,
  M: 80,
  ',': 81,
  '.': 82,
  '/': 83,
  RShift: 84,
  Up: 101,
  KP1: 86,
  KP2: 87,
  KP3: 88,
  KPEnter: 106,
  LCtrl: 91,
  LWin: 92,
  LAlt: 93,
  Space: 94,
  RAlt: 95,
  Fn: 96,
  Menu: 97,
  RCtrl: 98,
  Left: 99,
  Down: 100,
  Right: 102,
  KP0: 104,
  'KP.': 105,
};

export const LAYOUTS: Record<string, KeyboardLayout> = {
  'ak820-max': layoutMax as KeyboardLayout,
  'ak820-pro': layoutPro as KeyboardLayout,
  'ak820-pro-online': layoutProOnline as KeyboardLayout,
  'aula-nova75': layoutNova75 as KeyboardLayout,
  'ajazz-ak820-rgb': layoutAk820Rgb as KeyboardLayout,
  'aula-f108-pro': ansiLayout({
    id: 'aula-f108-pro',
    name: 'AULA F108 Pro (ANSI, 104 keys)',
    size: 'full',
    rightMods: 'fn',
    light: (n) => F108_PRO_KEYS[n] ?? null,
    source:
      'Key and LED indices from the vendor rgb-keyboard.xml as published by parsiya/f108-pro (MIT); standard ANSI geometry.',
  }),
};

const hexNum = (s: string): number => parseInt(s, 16);

export function getProfile(id: string): ModelProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}

export function getLayout(id: string): KeyboardLayout {
  const l = LAYOUTS[id];
  if (!l) throw new Error(`Unknown layout ${id}`);
  return l;
}

export interface ProfileMatch {
  profile: ModelProfile;
  score: number;
  reasons: string[];
}

/**
 * Static profile hints for a device. These only rank candidates; protocol probes and the device's
 * own answers always override them.
 */
export function matchProfiles(
  identity: { vendorId: number; productId: number; productName: string },
  usagePages: number[],
  protocolFamily?: string,
): ProfileMatch[] {
  const out: ProfileMatch[] = [];
  for (const p of PROFILES) {
    if (protocolFamily && p.protocolFamily !== protocolFamily) continue;
    const reasons: string[] = [];
    let score = 0;
    if (p.vendorIds.map(hexNum).includes(identity.vendorId)) {
      score += 1;
      reasons.push('vendor id');
    } else continue;
    if (p.productIds.map(hexNum).includes(identity.productId)) {
      score += 1;
      reasons.push('product id');
    }
    if (p.productNames.length) {
      if (p.productNames.includes(identity.productName)) {
        score += 3;
        reasons.push(`product string "${identity.productName}"`);
      } else {
        score -= 3;
      }
    }
    const pages = p.usagePages.map(hexNum);
    if (pages.length && pages.every((u) => usagePages.includes(u))) {
      score += 2;
      reasons.push('vendor usage pages');
    }
    if (score > 1) out.push({ profile: p, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}
export * from './catalog.js';
export * from './layouts/ansi.js';
export * from './guide.js';
