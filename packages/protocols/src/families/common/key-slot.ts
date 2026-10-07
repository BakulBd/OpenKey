import { modifierBitForUsage } from '@openak820/core';
import type { KeyAction, MacroPlayMode, MouseAction } from '@openak820/core';

/**
 * 4-byte key slot [page, p1, p2, p3] shared by both AJAZZ protocol families.
 *
 * Page numbers are the official online-driver enum `Da` (DEFAULT 0 … MPT 15). Pages 1, 2, 3 and 6
 * are encoded identically by the Windows driver (FUN_00418070) and the online driver
 * (decoders cn/rn/un/yn, encoder ll); family-specific pages live in the family codecs.
 */
export const Page = {
  DEFAULT: 0,
  MOUSE: 1,
  KEYBOARD: 2,
  CONSUMER_KEY: 3,
  SYSTEM_KEY: 4,
  EXTRA_FUNCTION: 5,
  MACRO: 6,
  CB: 7,
  DKS: 8,
  MT: 9,
  TGL: 10,
  SOCD: 11,
  RS: 12,
  FUNC: 13,
  END: 14,
  MPT: 15,
} as const;

/** [kind, value]: kind 1 = button mask, kind 3 = wheel step. */
export const MOUSE_ENCODING: Record<MouseAction, [number, number]> = {
  left: [0x01, 0x01],
  right: [0x01, 0x02],
  // Windows driver UI item "Double Click" (language id 224) encodes button value 3.
  'left+right': [0x01, 0x03],
  middle: [0x01, 0x04],
  back: [0x01, 0x08],
  forward: [0x01, 0x10],
  'wheel-up': [0x03, 0x01],
  'wheel-down': [0x03, 0xff],
};

/** Online driver recorder dropdown: 0 once, 1 repeat N, 2 toggle. */
export const MACRO_MODE: Record<MacroPlayMode, number> = {
  once: 0,
  repeat: 1,
  toggle: 2,
  'while-held': 3,
};

export type Slot = [number, number, number, number];

/** Encodes the actions both families share; returns null for anything family-specific. */
export function encodeCommonSlot(a: KeyAction): Slot | null {
  switch (a.kind) {
    case 'default':
      return [0, 0, 0, 0];
    case 'keyboard': {
      const bit = modifierBitForUsage(a.usage);
      // A bare modifier key is sent as its modifier bit with usage 0.
      if (bit !== undefined && a.modifiers === 0) return [Page.KEYBOARD, bit, 0, 0];
      return [Page.KEYBOARD, a.modifiers & 0xff, a.usage & 0xff, 0];
    }
    case 'consumer':
      return [Page.CONSUMER_KEY, a.usage & 0xff, (a.usage >> 8) & 0xff, 0];
    case 'mouse': {
      const [kind, value] = MOUSE_ENCODING[a.action];
      return [Page.MOUSE, kind, value, 0];
    }
    case 'macro':
      return [
        Page.MACRO,
        a.index & 0xff,
        MACRO_MODE[a.mode],
        a.mode === 'repeat' ? Math.max(1, Math.min(255, a.repeat)) : 0,
      ];
    case 'raw': {
      const b = [...a.bytes, 0, 0, 0, 0];
      return [b[0]! & 0xff, b[1]! & 0xff, b[2]! & 0xff, b[3]! & 0xff];
    }
    default:
      return null;
  }
}

/** Decodes shared pages; returns null for pages the family must interpret. */
export function decodeCommonSlot(bytes: ArrayLike<number>): KeyAction | null {
  const [p = 0, b1 = 0, b2 = 0, b3 = 0] = Array.from(bytes);
  if (p === 0 && b1 === 0 && b2 === 0 && b3 === 0) return { kind: 'default' };
  switch (p) {
    case Page.KEYBOARD:
      if (b2 === 0 && b3 === 0 && b1 !== 0 && (b1 & (b1 - 1)) === 0)
        return { kind: 'keyboard', usage: 0xe0 + Math.log2(b1), modifiers: 0 };
      return { kind: 'keyboard', modifiers: b1, usage: b2 };
    case Page.CONSUMER_KEY:
      return { kind: 'consumer', usage: b1 | (b2 << 8) };
    case Page.MOUSE: {
      const hit = (Object.entries(MOUSE_ENCODING) as [MouseAction, [number, number]][]).find(
        ([, [k, v]]) => k === b1 && v === b2,
      );
      return hit ? { kind: 'mouse', action: hit[0] } : { kind: 'raw', bytes: [p, b1, b2, b3] };
    }
    case Page.MACRO: {
      const mode = (Object.entries(MACRO_MODE) as [MacroPlayMode, number][]).find(
        ([, v]) => v === b2,
      )?.[0];
      return mode
        ? { kind: 'macro', index: b1, mode, repeat: b3 }
        : { kind: 'raw', bytes: [p, b1, b2, b3] };
    }
    default:
      return null;
  }
}
