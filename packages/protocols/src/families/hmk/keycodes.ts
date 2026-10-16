import type { KeyAction, MouseAction } from '@openkey/core';

/**
 * libhmk keycodes are one byte (include/keycodes.h); src/keycodes.c maps them to HID usages.
 * 0x02–0x63 are HID keyboard usages 0x04–0x65 in order; F13–F24, the international and language
 * keys and the modifiers sit in fixed ranges; then system, consumer and mouse keys; 0xC0+ are
 * layer, profile and lock functions.
 */
const CONSUMER: Record<number, number> = {
  0x86: 0xe2,
  0x87: 0xe9,
  0x88: 0xea,
  0x89: 0xb5,
  0x8a: 0xb6,
  0x8b: 0xb7,
  0x8c: 0xcd,
  0x8d: 0x183,
  0x8e: 0x18a,
  0x8f: 0x192,
  0x90: 0x194,
  0x91: 0x221,
  0x92: 0x223,
  0x93: 0x224,
  0x94: 0x225,
  0x95: 0x227,
  0x96: 0x22a,
  0x97: 0x6f,
  0x98: 0x70,
  0x99: 0x29f,
  0x9a: 0x2a0,
};
const SYSTEM: Record<number, number> = { 0x83: 0x81, 0x84: 0x82, 0x85: 0x83 };
const MOUSE: MouseAction[] = ['left', 'right', 'middle', 'back', 'forward'];
const SPECIAL: Record<number, string> = {
  0x01: 'Transparent',
  0xd0: 'Key lock',
  0xd1: 'Layer lock',
  0xd2: 'Profile swap',
  0xd3: 'Next profile',
  0xd4: 'Bootloader',
};
/** Never assigned by OpenKey. */
export const HMK_BOOT_KEY = 0xd4;

function keyboardUsage(code: number): number | null {
  if (code >= 0x02 && code <= 0x63) return code + 0x02;
  if (code >= 0x64 && code <= 0x6f) return code + 0x04;
  if (code >= 0x70 && code <= 0x75) return code + 0x17;
  if (code >= 0x76 && code <= 0x7a) return code + 0x1a;
  if (code >= 0x7b && code <= 0x82) return code + 0x65;
  return null;
}

function codeOfKeyboardUsage(u: number): number | null {
  if (u >= 0x04 && u <= 0x65) return u - 0x02;
  if (u >= 0x68 && u <= 0x73) return u - 0x04;
  if (u >= 0x87 && u <= 0x8c) return u - 0x17;
  if (u >= 0x90 && u <= 0x94) return u - 0x1a;
  if (u >= 0xe0 && u <= 0xe7) return u - 0x65;
  return null;
}

export function hmkToAction(code: number): KeyAction {
  if (code === 0x00) return { kind: 'disabled' };
  const kb = keyboardUsage(code);
  if (kb !== null) return { kind: 'keyboard', usage: kb, modifiers: 0 };
  if (SYSTEM[code] !== undefined) return { kind: 'system', usage: SYSTEM[code] };
  if (CONSUMER[code] !== undefined) return { kind: 'consumer', usage: CONSUMER[code] };
  if (code >= 0x9b && code <= 0x9f) return { kind: 'mouse', action: MOUSE[code - 0x9b]! };
  if (code >= 0xc0 && code <= 0xc7) return { kind: 'layer', layer: code - 0xc0, mode: 'momentary' };
  if (code >= 0xc8 && code <= 0xcf)
    return { kind: 'special', code, label: `Profile ${code - 0xc8}` };
  if (SPECIAL[code]) return { kind: 'special', code, label: SPECIAL[code] };
  return { kind: 'raw', bytes: [code] };
}

/** The byte for an action, or null when libhmk has no single keycode for it. */
export function actionToHmk(a: KeyAction): number | null {
  switch (a.kind) {
    case 'disabled':
      return 0x00;
    case 'keyboard':
      return a.modifiers ? null : codeOfKeyboardUsage(a.usage);
    case 'system': {
      const e = Object.entries(SYSTEM).find(([, u]) => u === a.usage);
      return e ? Number(e[0]) : null;
    }
    case 'consumer': {
      const e = Object.entries(CONSUMER).find(([, u]) => u === a.usage);
      return e ? Number(e[0]) : null;
    }
    case 'mouse': {
      const i = MOUSE.indexOf(a.action);
      return i >= 0 ? 0x9b + i : null;
    }
    case 'layer':
      return a.mode === 'momentary' && a.layer >= 0 && a.layer < 8 ? 0xc0 + a.layer : null;
    case 'special':
      return a.code >= 0 &&
        a.code <= 0xff &&
        (SPECIAL[a.code] || (a.code >= 0xc8 && a.code <= 0xcf))
        ? a.code
        : null;
    case 'raw':
      return a.bytes.length === 1 ? a.bytes[0]! : null;
    default:
      return null;
  }
}

/** Functions offered in the key picker (bootloader excluded). */
export function hmkSpecials(profiles: number): { code: number; label: string }[] {
  return [
    { code: 0x01, label: 'Transparent' },
    ...Array.from({ length: Math.min(8, profiles) }, (_, i) => ({
      code: 0xc8 + i,
      label: `Profile ${i}`,
    })),
    { code: 0xd0, label: 'Key lock' },
    { code: 0xd1, label: 'Layer lock' },
    { code: 0xd2, label: 'Profile swap' },
    { code: 0xd3, label: 'Next profile' },
  ];
}
