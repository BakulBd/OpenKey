import { ProtocolError, modifierBitForUsage } from '@openkey/core';
import type { KeyAction, KeyboardLayout, MouseAction, PerKeyRgb, Rgb } from '@openkey/core';

/**
 * Key matrix and per-key colours of BY Tech ("BeiYing") boards, from RK's own web driver
 * (drive.rkgaming.com, protocol `BeiYing`; facts only):
 *
 * - key matrix: read 0x83 / write 0x03, parameter `layer | table << 2` (layer 0 normal, 1 FN1,
 *   2 FN2, 3 tap; table 0 Windows, 1 Mac); 6 rows × 21 columns, index = column × 6 + row, 4 bytes
 *   each, big-endian: `type << 24 | parameter << 16 | code`;
 * - colours: read 0x86 / write 0x06, 126 LEDs (same index as the matrix) stored as three planes:
 *   all reds, then all greens, then all blues;
 * - effect 18 ("SelfDefine") shows the colour table.
 *
 * Key types: 0 keyboard (parameter = modifier mask, code = HID usage), 1 mouse, 2 media (consumer
 * usage), 3 macro, 7 special, 8 lighting, 0x0D Fn layer keys. OpenKey writes keyboard, media,
 * mouse and a short list of special and lighting functions; anything else read from the keyboard is
 * kept byte for byte.
 */
export const MATRIX_KEYS = 126;
export const MATRIX_BYTES = MATRIX_KEYS * 4;
export const LED_COUNT = 126;
export const COLOR_BYTES = LED_COUNT * 3;
export const SELF_DEFINE_EFFECT = 18;

export const MatrixCmd = {
  GET_KEY_MATRIX: 0x83,
  SET_KEY_MATRIX: 0x03,
  GET_LED_COLORS: 0x86,
  SET_LED_COLORS: 0x06,
} as const;

/** Layers OpenKey edits: normal, FN1, FN2 (the tap layer is left alone). */
export const MATRIX_LAYERS = { base: 0, fn: 1, layer2: 2 } as const;
export const WIN_TABLE = 0;
export const matrixParameter = (layer: number, table = WIN_TABLE): number =>
  (layer & 0x03) | ((table & 0x01) << 2);

const TYPE = { KEYBOARD: 0, MOUSE: 1, MEDIA: 2, SPECIAL: 7, LIGHTING: 8, FN: 0x0d } as const;

const MOUSE: Record<string, number> = {
  left: 1,
  right: 2,
  middle: 3,
  back: 4,
  forward: 5,
  'wheel-up': 8,
  'wheel-down': 9,
};

/** Functions offered besides keys: Win lock and the keyboard's own lighting controls. */
export const SPECIAL_ACTIONS: readonly { code: number; label: string }[] = [
  { code: 0x07000001, label: 'Win key lock' },
  { code: 0x0700000b, label: 'Lighting on / off' },
  { code: 0x08000100, label: 'Next lighting effect' },
  { code: 0x08000200, label: 'Previous lighting effect' },
  { code: 0x08030100, label: 'Brightness up' },
  { code: 0x08030200, label: 'Brightness down' },
  { code: 0x08040100, label: 'Lighting speed up' },
  { code: 0x08040200, label: 'Lighting speed down' },
];
const FN_LABELS: Record<number, string> = { 0x0d000000: 'Fn', 0x0d010000: 'Fn2' };

/** The 32-bit code of a key action; `current` is what the key holds now (kept for `raw`). */
export function encodeAction(a: KeyAction, current: number): number {
  switch (a.kind) {
    case 'disabled':
      return 0;
    case 'keyboard': {
      const mods = a.modifiers & 0xff;
      const bit = modifierBitForUsage(a.usage);
      if (bit !== undefined) return ((mods | bit) << 16) >>> 0;
      if (a.usage < 0 || a.usage > 0xff) throw new ProtocolError('Key usage out of range.');
      if (!a.usage && !mods) throw new ProtocolError('A key needs a key or a modifier.');
      return ((mods << 16) | a.usage) >>> 0;
    }
    case 'consumer':
      if (a.usage < 1 || a.usage > 0xffff) throw new ProtocolError('Media usage out of range.');
      return ((TYPE.MEDIA << 24) | a.usage) >>> 0;
    case 'mouse': {
      const n = MOUSE[a.action];
      if (!n) throw new ProtocolError(`This keyboard has no “${a.action}” mouse function.`);
      return ((TYPE.MOUSE << 24) | (n << 16) | 0x0100) >>> 0;
    }
    case 'special':
      if (!SPECIAL_ACTIONS.some((s) => s.code === a.code) && a.code !== current)
        throw new ProtocolError(`Function 0x${a.code.toString(16)} is not offered.`);
      return a.code >>> 0;
    case 'raw': {
      const code = a.bytes.reduce((v, b) => (v << 8) | (b & 0xff), 0) >>> 0;
      if (a.bytes.length !== 4 || code !== current)
        throw new ProtocolError('Only an unchanged keyboard code can be written back as raw.');
      return code;
    }
    default:
      throw new ProtocolError(`BY Tech key maps cannot hold “${a.kind}”.`);
  }
}

/** The action a 32-bit code stands for; codes OpenKey does not write come back as `raw`. */
export function decodeAction(code: number): KeyAction {
  const type = code >>> 24;
  const param = (code >>> 16) & 0xff;
  const low = code & 0xffff;
  if (code === 0) return { kind: 'disabled' };
  if (type === TYPE.KEYBOARD && low <= 0xff) {
    if (low === 0 && param) {
      // A modifier key on its own: the lowest bit is the key, the rest are held with it.
      const bit = param & -param;
      return { kind: 'keyboard', usage: 0xe0 + Math.log2(bit), modifiers: param & ~bit };
    }
    return { kind: 'keyboard', usage: low, modifiers: param };
  }
  if (type === TYPE.MEDIA && param === 0) return { kind: 'consumer', usage: low };
  if (type === TYPE.MOUSE && low === 0x0100) {
    const action = Object.entries(MOUSE).find(([, n]) => n === param)?.[0];
    if (action) return { kind: 'mouse', action: action as MouseAction };
  }
  const special = SPECIAL_ACTIONS.find((s) => s.code === code);
  if (special) return { kind: 'special', code, label: special.label };
  if (FN_LABELS[code]) return { kind: 'special', code, label: FN_LABELS[code] };
  const named = describeCode(code);
  if (named) return { kind: 'special', code, label: named };
  return {
    kind: 'raw',
    bytes: [code >>> 24, (code >>> 16) & 0xff, (code >>> 8) & 0xff, code & 0xff],
  };
}

const SPECIAL_NAMES: Record<number, string> = {
  0x00: 'Swap WASD / arrows',
  0x01: 'Win key lock',
  0x02: 'Lock all keys',
  0x03: 'Record macro',
  0x04: 'Reset profile',
  0x05: 'Bluetooth 1',
  0x06: 'Bluetooth 2',
  0x07: 'Bluetooth 3',
  0x08: 'Bluetooth 4',
  0x09: 'Bluetooth 5',
  0x0b: 'Lighting on / off',
  0x0c: 'Battery level',
  0x0d: 'Home',
  0x0e: 'Mute',
  0x13: 'Lighting off',
  0x20: 'Windows mode',
  0x21: 'Mac mode',
  0x24: 'Touch mode',
};
const LIGHT_PARTS: Record<number, string> = {
  0: 'effect',
  1: 'direction',
  2: 'colour',
  3: 'brightness',
  4: 'speed',
};

/**
 * A name for a keyboard function RK's web driver lists (lighting keys, Bluetooth slots, report rate,
 * macros …), or null. Such keys are shown by name and written back unchanged.
 */
export function describeCode(code: number): string | null {
  const type = code >>> 24;
  const sub = (code >>> 16) & 0xff;
  const step = (code >>> 8) & 0xff;
  if (type === 3) return `Macro ${(code & 0xffff) + 1}`;
  if (type === 7) return SPECIAL_NAMES[code & 0xffff] ?? 'Keyboard function';
  if (type === 8) {
    if (sub === 9) return `Lighting effect ${step}`;
    if (sub >= 5 && sub <= 8) return 'Record lighting';
    if (sub === 0xff) return 'Reset recorded keys';
    const part = LIGHT_PARTS[sub];
    if (part) return `Lighting ${part} ${step === 1 ? 'up' : step === 2 ? 'down' : 'cycle'}`;
    return 'Lighting key';
  }
  if (type === 9) return 'Report rate';
  if (type === 0x0a) return 'RK web';
  if (type === 0x10) return { 1: 'Power', 2: 'Sleep', 4: 'Wake up' }[code & 0xff] ?? 'Power key';
  return null;
}

/** True for the keyboard's Fn keys, which OpenKey never changes. */
export const isFnCode = (code: number): boolean => code >>> 24 === TYPE.FN;

export function readMatrix(bytes: Uint8Array): number[] {
  if (bytes.length < MATRIX_BYTES) throw new ProtocolError('Short key-matrix reply.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, MATRIX_BYTES);
  return Array.from({ length: MATRIX_KEYS }, (_, i) => v.getUint32(i * 4));
}

export function writeMatrix(codes: readonly number[]): Uint8Array {
  const out = new Uint8Array(MATRIX_BYTES);
  const v = new DataView(out.buffer);
  codes.forEach((c, i) => v.setUint32(i * 4, c >>> 0));
  return out;
}

/** The factory code of a key from its default HID usage (base layer). */
export function factoryCode(usage: number): number {
  const bit = modifierBitForUsage(usage);
  return bit !== undefined ? (bit << 16) >>> 0 : usage;
}

/** The base-layer factory codes the layout states (keys whose default usage is known). */
export function factoryCodes(layout: KeyboardLayout): Map<number, number> {
  const out = new Map<number, number>();
  for (const k of layout.keys)
    if (k.slot >= 0 && k.usage > 0) out.set(k.slot, factoryCode(k.usage));
  return out;
}

export function readColors(bytes: Uint8Array): Rgb[] {
  if (bytes.length < COLOR_BYTES) throw new ProtocolError('Short colour-table reply.');
  return Array.from({ length: LED_COUNT }, (_, i) => ({
    r: bytes[i]!,
    g: bytes[i + LED_COUNT]!,
    b: bytes[i + 2 * LED_COUNT]!,
  }));
}

/** The colour table with `colors` patched into `current`. */
export function patchColors(current: Uint8Array, colors: PerKeyRgb): Uint8Array {
  const out = current.slice(0, COLOR_BYTES);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  for (const [k, rgb] of Object.entries(colors)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= LED_COUNT)
      throw new ProtocolError(`LED ${k} out of range.`);
    out[i] = c(rgb.r);
    out[i + LED_COUNT] = c(rgb.g);
    out[i + 2 * LED_COUNT] = c(rgb.b);
  }
  return out;
}
