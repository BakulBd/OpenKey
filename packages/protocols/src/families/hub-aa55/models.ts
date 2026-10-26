import type { KeyboardLayout } from '@openkey/core';
import { ansiKeys, ansiLayout } from '@openkey/devices';
import { webLayout } from './webboards.js';
import type { WebBoard } from './webboards.js';

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
  /**
   * Key-table index per key name, for key maps (AJAZZ's own web driver, `keyList[].value`). On the
   * F87S it is its LED map; the AK680 uses the same numbering.
   */
  keys?: Record<string, number>;
  layout?: 'tkl' | '65';
  /** A board from AJAZZ's own web driver (key rows, pages, ranges). */
  web?: WebBoard;
  /** The LED map is the key map, not confirmed LED by LED (web-driver boards). */
  ledAssumed?: boolean;
  /** Lighting zones with one colour each, read and written as 24-byte blocks. */
  zones?: readonly HubZone[];
  source: string;
}

export interface HubZone {
  id: string;
  name: string;
  read: number;
  write: number;
}

/**
 * The F87S 8K's knob ring and side light bars (Dylan-1107/aula-f87s-hid HID-PROTOCOL.md §5.5, MIT):
 * one colour per zone; both side bars are one zone. Read, change, write back and read again was
 * tested by the source through the receiver; the cable path uses the same commands.
 */
const F87S_ZONES: readonly HubZone[] = [
  { id: 'ring', name: 'Knob ring', read: 0x1b, write: 0x2b },
  { id: 'side', name: 'Side light bars', read: 0x1d, write: 0x2d },
];

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
/** The AK680's key-table numbers, AJAZZ's own web driver (AK680 V2 and AK680 MAX entries). */
const AK680_KEYS: Record<string, number> = Object.fromEntries(
  Object.entries(F87S_LEDS).filter(
    ([name]) =>
      ![
        'F1',
        'F2',
        'F3',
        'F4',
        'F5',
        'F6',
        'F7',
        'F8',
        'F9',
        'F10',
        'F11',
        'F12',
        'PrtSc',
        'ScrLk',
        'Pause',
        '`',
        'Ins',
        'End',
      ].includes(name),
  ),
);
AK680_KEYS['Home'] = 104;
AK680_KEYS['Del'] = 106;
AK680_KEYS['PgUp'] = 105;
AK680_KEYS['PgDn'] = 108;

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
    keys: F87S_LEDS,
    layout: 'tkl',
    zones: F87S_ZONES,
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
    keys: F87S_LEDS,
    layout: 'tkl',
    zones: F87S_ZONES,
    source: F87S_SRC,
  },
  ...[0x80bc, 0x80c1, 0x80c2].map((productId): HubModel => ({
    name: 'AJAZZ AK680 V2',
    vendorId: 0x0c45,
    productId,
    link: 'usb',
    infoBytes: 48,
    body: { vendorId: 0x0c45, productId },
    keys: AK680_KEYS,
    layout: '65',
    source: AK680_SRC,
  })),
  {
    name: 'AJAZZ AK680 MAX (RGB)',
    vendorId: 0x0c45,
    productId: 0x80b2,
    link: 'usb',
    infoBytes: 48,
    body: { vendorId: 0x0c45, productId: 0x80b2 },
    keys: AK680_KEYS,
    layout: '65',
    source: AK680_SRC,
  },
];

export const hubModel = (vendorId: number, productId: number) =>
  HUB_MODELS.find((m) => m.vendorId === vendorId && m.productId === productId);

export function hubLayout(m: HubModel): KeyboardLayout | null {
  if (m.web) return webLayout(`hub-${m.body.productId.toString(16)}`, m.name, m.web);
  if (m.layout === '65' && m.keys) return layout65(m, m.keys);
  if (!m.ledMap || m.layout !== 'tkl') return null;
  const map = m.ledMap;
  const keys = m.keys ?? {};
  return ansiLayout({
    id: `hub-${m.body.productId.toString(16)}`,
    name: `${m.name.replace(/ \(.*\)$/, '')} (ANSI TKL)`,
    size: 'tkl',
    rightMods: 'fn',
    light: (n) => map[n] ?? null,
    // The Fn key keeps its function, so the Fn layer stays reachable.
    slot: (n) => (n === 'Fn' ? -1 : (keys[n] ?? -1)),
    source: m.source,
  });
}

/**
 * The 68-key 65 % board of the AK680, row by row as AJAZZ's web driver draws it (key widths from its
 * classes), keys numbered by its key table. No LED map is confirmed, so keys carry no LED.
 */
function layout65(m: HubModel, keys: Record<string, number>): KeyboardLayout {
  const rows: [string, number, number?][][] = [
    [
      ...['Esc', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='].map(
        (n): [string, number] => [n, 1],
      ),
      ['Backspace', 2],
      ['Home', 1],
    ],
    [
      ['Tab', 1.5],
      ...['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'].map((n): [string, number] => [
        n,
        1,
      ]),
      ['\\', 1.5],
      ['Del', 1],
    ],
    [
      ['Caps', 1.75],
      ...['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"].map((n): [string, number] => [
        n,
        1,
      ]),
      ['Enter', 2.25],
      ['PgUp', 1],
    ],
    [
      ['LShift', 2.25],
      ...['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'].map((n): [string, number] => [n, 1]),
      ['RShift', 1.75],
      ['Up', 1],
      ['PgDn', 1],
    ],
    [
      ['LCtrl', 1.25],
      ['LWin', 1.25],
      ['LAlt', 1.25],
      ['Space', 6.25],
      ['RAlt', 1],
      ['Fn', 1],
      ['RCtrl', 1],
      ['Left', 1],
      ['Down', 1],
      ['Right', 1],
    ],
  ];
  const usage = new Map(ansiKeys('tkl', 'fn').map((k) => [k.name, k]));
  const out: KeyboardLayout['keys'] = [];
  rows.forEach((row, y) => {
    let x = 0;
    for (const [name, w] of row) {
      const a = usage.get(name);
      out.push({
        id: name,
        label: a?.label ?? name,
        slot: name === 'Fn' ? -1 : (keys[name] ?? -1),
        light: null,
        usage: a?.usage ?? 0,
        x,
        y,
        w,
        h: 1,
      });
      x += w;
    }
  });
  return {
    id: `hub-${m.body.productId.toString(16)}`,
    name: `${m.name.replace(/ \(.*\)$/, '')} (65 %)`,
    width: 16,
    height: 5,
    keys: out,
    source: `${m.source}; rows and key numbers from AJAZZ’s own web driver`,
  };
}
