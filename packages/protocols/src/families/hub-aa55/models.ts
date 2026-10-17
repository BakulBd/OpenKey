import type { KeyboardLayout } from '@openkey/core';
import { ansiLayout } from '@openkey/devices';

export interface HubModel {
  name: string;
  vendorId: number;
  productId: number;
  link: 'usb' | '2.4ghz';
  /** Size of the device-info read each source uses for this model. */
  infoBytes: number;
  /** The keyboard's own VID:PID as the device-info reply reports it (receivers relay it). */
  body: { vendorId: number; productId: number };
  /** LED slot per key name (`ansiLayout` names); only models with a confirmed map get per-key colours. */
  ledMap?: Record<string, number>;
  layout?: 'tkl';
  source: string;
}

/** AULA F87S 8K: row-major LED addresses, confirmed on the keyboard key by key (KEY-MAPPING.md). */
const F87S_LEDS: Record<string, number> = {
  Esc: 0,
  F1: 1,
  F2: 2,
  F3: 3,
  F4: 4,
  F5: 5,
  F6: 6,
  F7: 7,
  F8: 8,
  F9: 9,
  F10: 10,
  F11: 11,
  F12: 12,
  PrtSc: 99,
  ScrLk: 100,
  Pause: 102,
  '`': 16,
  '1': 17,
  '2': 18,
  '3': 19,
  '4': 20,
  '5': 21,
  '6': 22,
  '7': 23,
  '8': 24,
  '9': 25,
  '0': 26,
  '-': 27,
  '=': 28,
  Backspace: 92,
  Ins: 103,
  Home: 104,
  PgUp: 105,
  Tab: 32,
  Q: 33,
  W: 34,
  E: 35,
  R: 36,
  T: 37,
  Y: 38,
  U: 39,
  I: 40,
  O: 41,
  P: 42,
  '[': 43,
  ']': 44,
  '\\': 60,
  Del: 106,
  End: 107,
  PgDn: 108,
  Caps: 48,
  A: 49,
  S: 50,
  D: 51,
  F: 52,
  G: 53,
  H: 54,
  J: 55,
  K: 56,
  L: 57,
  ';': 58,
  "'": 59,
  Enter: 76,
  LShift: 64,
  Z: 65,
  X: 66,
  C: 67,
  V: 68,
  B: 69,
  N: 70,
  M: 71,
  ',': 72,
  '.': 73,
  '/': 74,
  RShift: 75,
  Up: 90,
  LCtrl: 80,
  LWin: 81,
  LAlt: 82,
  Space: 83,
  RAlt: 84,
  Fn: 85,
  Menu: 86,
  RCtrl: 87,
  Left: 88,
  Down: 89,
  Right: 91,
};

const F87S_SRC = 'Dylan-1107/aula-f87s-hid (MIT), verified on an F87S 8K by the source';
const AK680_SRC =
  '10ishk/ak680-studio (Apache-2.0) and somenever/not-ajazz-ak680-max-webhid (GPL-3.0, facts only)';

export const HUB_MODELS: readonly HubModel[] = [
  {
    name: 'AULA F87S 8K',
    vendorId: 0x38a6,
    productId: 0x2908,
    link: 'usb',
    infoBytes: 56,
    body: { vendorId: 0x38a6, productId: 0x2908 },
    ledMap: F87S_LEDS,
    layout: 'tkl',
    source: F87S_SRC,
  },
  {
    name: 'AULA F87S 8K (2.4 GHz receiver)',
    vendorId: 0x0c45,
    productId: 0xfef9,
    link: '2.4ghz',
    infoBytes: 56,
    body: { vendorId: 0x38a6, productId: 0x2908 },
    ledMap: F87S_LEDS,
    layout: 'tkl',
    source: F87S_SRC,
  },
  ...[0x80bc, 0x80c1, 0x80c2].map((productId): HubModel => ({
    name: 'AJAZZ AK680 V2',
    vendorId: 0x0c45,
    productId,
    link: 'usb',
    infoBytes: 48,
    body: { vendorId: 0x0c45, productId },
    source: AK680_SRC,
  })),
  {
    name: 'AJAZZ AK680 MAX (RGB)',
    vendorId: 0x0c45,
    productId: 0x80b2,
    link: 'usb',
    infoBytes: 48,
    body: { vendorId: 0x0c45, productId: 0x80b2 },
    source: AK680_SRC,
  },
];

export const hubModel = (vendorId: number, productId: number) =>
  HUB_MODELS.find((m) => m.vendorId === vendorId && m.productId === productId);

export function hubLayout(m: HubModel): KeyboardLayout | null {
  if (!m.ledMap || m.layout !== 'tkl') return null;
  const map = m.ledMap;
  return ansiLayout({
    id: `hub-${m.body.productId.toString(16)}`,
    name: `${m.name.replace(/ \(.*\)$/, '')} (ANSI TKL)`,
    size: 'tkl',
    rightMods: 'fn',
    light: (n) => map[n] ?? null,
    source: m.source,
  });
}
