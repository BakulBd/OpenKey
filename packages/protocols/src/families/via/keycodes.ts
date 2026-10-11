import type { KeyAction, MouseAction } from '@openkey/core';

/**
 * QMK keycodes ↔ OpenKey key actions. QMK changed its numbering in 0.19 (keycodes "v2", VIA protocol
 * 0x000C+); the basic HID range and the modifier encoding are the same in both. Values are from QMK
 * `quantum/keycodes.h` (v2) and the VIA app's v10/v11 tables (v1); facts only, no code reused.
 *
 * Anything without a protocol-neutral action becomes `special` carrying the exact 16-bit keycode, so
 * a key read from the keyboard is written back unchanged.
 */
export type KeycodeVersion = 1 | 2;

/** QMK basic consumer keycodes → HID Consumer page usages (QMK `KEYCODE2CONSUMER`). */
const CONSUMER: readonly [number, number][] = [
  [0xa8, 0x00e2], [0xa9, 0x00e9], [0xaa, 0x00ea], [0xab, 0x00b5], [0xac, 0x00b6], [0xad, 0x00b7],
  [0xae, 0x00cd], [0xaf, 0x0183], [0xb0, 0x00b8], [0xb1, 0x018a], [0xb2, 0x0192], [0xb3, 0x0194],
  [0xb4, 0x0221], [0xb5, 0x0223], [0xb6, 0x0224], [0xb7, 0x0225], [0xb8, 0x0226], [0xb9, 0x0227],
  [0xba, 0x022a], [0xbb, 0x00b3], [0xbc, 0x00b4], [0xbd, 0x006f], [0xbe, 0x0070], [0xbf, 0x019f],
  [0xc0, 0x01cb], [0xc1, 0x029f], [0xc2, 0x02a0],
];
const CONSUMER_TO_QMK = new Map(CONSUMER.map(([q, u]) => [u, q]));
const QMK_TO_CONSUMER = new Map(CONSUMER);
/** QMK system keycodes → HID Generic Desktop system usages. */
const SYSTEM: readonly [number, number][] = [
  [0xa5, 0x81],
  [0xa6, 0x82],
  [0xa7, 0x83],
];

const MOUSE: Record<KeycodeVersion, Partial<Record<MouseAction, number>>> = {
  2: { left: 0xd1, right: 0xd2, middle: 0xd3, back: 0xd4, forward: 0xd5, 'wheel-up': 0xd9, 'wheel-down': 0xda },
  1: { left: 0xf4, right: 0xf5, middle: 0xf6, back: 0xf7, forward: 0xf8, 'wheel-up': 0xf9, 'wheel-down': 0xfa },
};

/** Layer keycode bases per version (layer number added to the base). */
const LAYER = {
  2: { TO: 0x5200, MO: 0x5220, DF: 0x5240, TG: 0x5260, OSL: 0x5280, TT: 0x52c0, max: 31 },
  1: { TO: 0x5000, MO: 0x5100, DF: 0x5200, TG: 0x5300, OSL: 0x5400, TT: 0x5800, max: 15 },
} as const;
const MACRO_BASE: Record<KeycodeVersion, number> = { 2: 0x7700, 1: 0x5f12 };
export const KC_NO = 0x0000;
export const KC_TRANSPARENT = 0x0001;

/** Names for keycodes shown as `special`, so keycaps read "Grave Esc" rather than a number. */
const NAMES_V2: Record<number, string> = {
  0x0001: '▽ Transparent',
  0x7800: 'Backlight on',
  0x7801: 'Backlight off',
  0x7802: 'Backlight toggle',
  0x7803: 'Backlight −',
  0x7804: 'Backlight +',
  0x7805: 'Backlight step',
  0x7806: 'Backlight breathing',
  0x7820: 'RGB toggle',
  0x7821: 'RGB mode +',
  0x7822: 'RGB mode −',
  0x7823: 'Hue +',
  0x7824: 'Hue −',
  0x7825: 'Saturation +',
  0x7826: 'Saturation −',
  0x7827: 'Brightness +',
  0x7828: 'Brightness −',
  0x7829: 'Effect speed +',
  0x782a: 'Effect speed −',
  0x7840: 'RGB matrix on',
  0x7841: 'RGB matrix off',
  0x7842: 'RGB matrix toggle',
  0x7843: 'RGB matrix mode +',
  0x7844: 'RGB matrix mode −',
  0x7845: 'RGB matrix hue +',
  0x7846: 'RGB matrix hue −',
  0x7847: 'RGB matrix saturation +',
  0x7848: 'RGB matrix saturation −',
  0x7849: 'RGB matrix brightness +',
  0x784a: 'RGB matrix brightness −',
  0x784b: 'RGB matrix speed +',
  0x784c: 'RGB matrix speed −',
  0x7c00: 'Bootloader (QK_BOOT)',
  0x7c01: 'Reboot',
  0x7c02: 'Debug toggle',
  0x7c03: 'Clear EEPROM',
  0x7c16: 'Grave Esc',
  0x7c58: 'Leader',
  0x7c59: 'Lock',
  0x7c73: 'Caps Word',
};
const NAMES_V1: Record<number, string> = { 0x0001: '▽ Transparent', 0x5c00: 'Bootloader (RESET)', 0x5c16: 'Grave Esc' };

/**
 * Keycodes that reboot the keyboard into its bootloader or erase its settings when pressed. They are
 * shown when read, but never offered for assignment.
 */
export const DANGEROUS: Record<KeycodeVersion, ReadonlySet<number>> = {
  2: new Set([0x7c00, 0x7c01, 0x7c03, 0x7c04]),
  1: new Set([0x5c00, 0x5c01, 0x5c02]),
};

/** Special keys OpenKey offers for assignment on VIA boards (never the dangerous ones). */
export function offeredSpecials(v: KeycodeVersion): { code: number; label: string }[] {
  const names = v === 2 ? NAMES_V2 : NAMES_V1;
  return Object.entries(names)
    .map(([code, label]) => ({ code: Number(code), label }))
    .filter((s) => !DANGEROUS[v].has(s.code));
}

const MOD_NAMES = ['Ctrl', 'Shift', 'Alt', 'GUI'];
const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

export function keycodeLabel(code: number, v: KeycodeVersion): string {
  const names = v === 2 ? NAMES_V2 : NAMES_V1;
  if (names[code]) return names[code]!;
  const L = LAYER[v];
  const layerOf = (base: number) => code - base;
  for (const [name, base] of [['TO', L.TO], ['DF', L.DF], ['OSL', L.OSL], ['TT', L.TT]] as const)
    if (code >= base && code <= base + L.max) return `${name}(${layerOf(base)})`;
  if (code >= 0x4000 && code <= 0x4fff) return `LT(${(code >> 8) & 0x0f}, ${hex(code & 0xff)})`;
  if (v === 2 && code >= 0x2000 && code <= 0x3fff) return `MT(${modLabel((code >> 8) & 0x1f)}, ${hex(code & 0xff)})`;
  if (v === 2 && code >= 0x52a0 && code <= 0x52bf) return `OSM(${modLabel(code & 0x1f)})`;
  if (v === 2 && code >= 0x5700 && code <= 0x57ff) return `Tap dance ${code & 0xff}`;
  return `QMK ${hex(code)}`;
}

function modLabel(m5: number): string {
  const side = m5 & 0x10 ? 'R' : 'L';
  return MOD_NAMES.filter((_, i) => m5 & (1 << i))
    .map((n) => side + n)
    .join('+');
}

/** QMK 5-bit modifier field → OpenKey modifier bitmask (bit0 LCtrl … bit7 RGUI). */
function modsFrom5(m5: number): number {
  return m5 & 0x10 ? (m5 & 0x0f) << 4 : m5 & 0x0f;
}

/** OpenKey modifier bitmask → QMK 5-bit field; null when left and right modifiers are mixed. */
function modsTo5(mods: number): number | null {
  const left = mods & 0x0f;
  const right = (mods >> 4) & 0x0f;
  if (left && right) return null;
  return right ? 0x10 | right : left;
}

export function decodeKeycode(code: number, v: KeycodeVersion): KeyAction {
  if (code === KC_NO) return { kind: 'disabled' };
  const basic = code & 0xff;
  if (code <= 0xff) {
    if ((basic >= 0x04 && basic <= 0xa4) || (basic >= 0xe0 && basic <= 0xe7)) return { kind: 'keyboard', usage: basic, modifiers: 0 };
    const consumer = QMK_TO_CONSUMER.get(basic);
    if (consumer !== undefined) return { kind: 'consumer', usage: consumer };
    const sys = SYSTEM.find(([q]) => q === basic);
    if (sys) return { kind: 'system', usage: sys[1] };
    const mouse = Object.entries(MOUSE[v]).find(([, c]) => c === basic);
    if (mouse) return { kind: 'mouse', action: mouse[0] as MouseAction };
  }
  if (code >= 0x0100 && code <= 0x1fff && ((basic >= 0x04 && basic <= 0xa4) || (basic >= 0xe0 && basic <= 0xe7)))
    return { kind: 'keyboard', usage: basic, modifiers: modsFrom5(code >> 8) };
  const L = LAYER[v];
  if (code >= L.MO && code <= L.MO + L.max) return { kind: 'layer', layer: code - L.MO, mode: 'momentary' };
  if (code >= L.TG && code <= L.TG + L.max) return { kind: 'layer', layer: code - L.TG, mode: 'toggle' };
  const m = MACRO_BASE[v];
  if (code >= m && code < m + (v === 2 ? 0x80 : 16)) return { kind: 'macro', index: code - m, mode: 'once', repeat: 0 };
  return { kind: 'special', code, label: keycodeLabel(code, v) };
}

export class UnencodableKeyError extends Error {}

export function encodeKeycode(a: KeyAction, v: KeycodeVersion): number {
  switch (a.kind) {
    case 'disabled':
      return KC_NO;
    case 'keyboard': {
      if (!a.modifiers) return a.usage & 0xff;
      const m5 = modsTo5(a.modifiers);
      if (m5 === null) throw new UnencodableKeyError('QMK cannot combine left and right modifiers on one key');
      return (m5 << 8) | (a.usage & 0xff);
    }
    case 'consumer': {
      const q = CONSUMER_TO_QMK.get(a.usage);
      if (q === undefined) throw new UnencodableKeyError(`consumer usage 0x${a.usage.toString(16)} has no QMK keycode`);
      return q;
    }
    case 'system': {
      const s = SYSTEM.find(([, u]) => u === a.usage);
      if (!s) throw new UnencodableKeyError(`system usage 0x${a.usage.toString(16)} has no QMK keycode`);
      return s[0];
    }
    case 'mouse': {
      const c = MOUSE[v][a.action];
      if (c === undefined) throw new UnencodableKeyError(`mouse action ${a.action} has no QMK keycode`);
      return c;
    }
    case 'layer': {
      const L = LAYER[v];
      if (a.layer < 0 || a.layer > L.max) throw new UnencodableKeyError(`layer ${a.layer} is out of range`);
      return (a.mode === 'toggle' ? L.TG : L.MO) + a.layer;
    }
    case 'macro':
      if (a.mode !== 'once') throw new UnencodableKeyError('VIA macros play once per press');
      return MACRO_BASE[v] + a.index;
    case 'special':
      if (DANGEROUS[v].has(a.code)) throw new UnencodableKeyError('bootloader and erase keycodes are not assigned by OpenKey');
      return a.code & 0xffff;
    case 'default':
    case 'raw':
      throw new UnencodableKeyError(`${a.kind} has no QMK keycode`);
  }
}
