import { ProtocolError, modifierBitForUsage } from '@openkey/core';
import type { KeyAction, KeyboardLayout, Macro, MacroLimits, MouseAction } from '@openkey/core';
import { REPORT_LEN } from './codec.js';

/**
 * AJ179 button mapping and macros, from Rockeyxx/aj179-linux docs/PROTOCOL.md (MIT): decoded from the
 * vendor driver (0x432d9c, 0x433ed0) and checked on the mouse by the source (a button remapped to
 * the wheel scrolled; macro "a b" in slot 3 typed a and b on the rear button). The mouse cannot
 * report either back, so OpenKey shows what it last wrote.
 *
 * Button table (`09`): `09 00 01 0F` and 3 bytes per button for buttons 0–5 (left, right, middle,
 * back, forward, DPI). The length byte is 0x0F although six entries follow, as the vendor sends it.
 */
export const SET_MACRO = 0x08;
export const SET_BUTTONS = 0x09;
export const BUTTONS = 6;
const BUTTON_TABLE_LEN = 0x0f;
const PAYLOAD = 27;

export const BUTTON_NAMES = ['Left', 'Right', 'Middle', 'Back', 'Forward', 'DPI'] as const;
/** The vendor's factory table: left, right, middle, back, forward, DPI cycle. */
export const FACTORY: readonly (readonly [number, number, number])[] = [
  [0x10, 0x01, 0x00],
  [0x10, 0x02, 0x00],
  [0x10, 0x04, 0x00],
  [0x10, 0x08, 0x00],
  [0x10, 0x10, 0x00],
  [0x40, 0x01, 0x00],
];
/** The left button keeps its function, so the mouse can always click to undo a change. */
export const LOCKED_BUTTON = 0;

const MOUSE: Partial<Record<MouseAction, readonly [number, number, number]>> = {
  left: [0x10, 0x01, 0x00],
  right: [0x10, 0x02, 0x00],
  middle: [0x10, 0x04, 0x00],
  back: [0x10, 0x08, 0x00],
  forward: [0x10, 0x10, 0x00],
  'wheel-up': [0x20, 0x01, 0x00],
  'wheel-down': [0x20, 0xff, 0x00],
};

/** Mouse functions without a generic action, as `special` codes (the three bytes of the entry). */
export const SPECIAL: readonly { code: number; label: string }[] = [
  { code: 0x400100, label: 'DPI cycle' },
  { code: 0x400200, label: 'DPI up' },
  { code: 0x400300, label: 'DPI down' },
  { code: 0x1000f5, label: 'Scroll left' },
  { code: 0x1000f6, label: 'Scroll right' },
];

/** Macro play modes (`90 slot|mode count`): until release, until any click, N times. */
const MODE = { 'while-held': 0x10, toggle: 0x40, once: 0x20, repeat: 0x20 } as const;

/** Button entry for an action; macros play from the slot of the button they are on. */
export function buttonEntry(button: number, a: KeyAction): readonly [number, number, number] {
  switch (a.kind) {
    case 'default':
      return FACTORY[button]!;
    case 'mouse': {
      const e = MOUSE[a.action];
      if (!e) throw new ProtocolError(`The AJ179 has no “${a.action}” function.`);
      return e;
    }
    case 'keyboard':
      if (a.usage < 0 || a.usage > 0xff) throw new ProtocolError('Key usage out of range.');
      return [0x70, a.modifiers & 0xff, a.usage];
    case 'consumer':
      return [0x80, a.usage & 0xff, (a.usage >> 8) & 0xff];
    case 'special': {
      if (!SPECIAL.some((s) => s.code === a.code))
        throw new ProtocolError(`Unknown AJ179 function 0x${a.code.toString(16)}.`);
      return [(a.code >> 16) & 0xff, (a.code >> 8) & 0xff, a.code & 0xff];
    }
    case 'macro': {
      const count = a.mode === 'repeat' ? a.repeat : 1;
      if (!Number.isInteger(count) || count < 1 || count > 255)
        throw new ProtocolError('A macro repeats 1–255 times.');
      return [
        0x90,
        (button & 0x0f) | MODE[a.mode],
        a.mode === 'once' || a.mode === 'repeat' ? count : 0,
      ];
    }
    default:
      throw new ProtocolError(`The AJ179 cannot map a button to “${a.kind}”.`);
  }
}

function checksum(f: Uint8Array): void {
  f[REPORT_LEN - 1] = f.subarray(4, REPORT_LEN - 1).reduce((x, y) => x + y, 0) & 0xff;
}

/** The whole button table for `slots` (button index → action; missing = factory). */
export function buttonPacket(slots: Record<number, KeyAction>): Uint8Array {
  const f = new Uint8Array(REPORT_LEN);
  f.set([SET_BUTTONS, 0x00, 0x01, BUTTON_TABLE_LEN]);
  for (let b = 0; b < BUTTONS; b++) {
    const a =
      b === LOCKED_BUTTON ? { kind: 'default' as const } : (slots[b] ?? { kind: 'default' });
    f.set(buttonEntry(b, a), 4 + b * 3);
  }
  checksum(f);
  return f;
}

/**
 * Macro events: `type delayLo delayHi code`, the delay (≥ 1 ms) being the pause after the event.
 * OpenKey's separate delay events are folded into the event before them.
 */
export function macroEvents(m: Macro): number[] {
  const out: number[][] = [];
  for (const e of m.events) {
    if (e.type === 'delay') {
      const last = out.at(-1);
      if (last) {
        const ms = Math.min(0xffff, (last[1]! | (last[2]! << 8)) - 1 + Math.max(1, e.ms));
        last[1] = ms & 0xff;
        last[2] = ms >> 8;
      }
      continue;
    }
    if (e.type === 'mouse') {
      const mask = { left: 0x01, right: 0x02, middle: 0x04 }[e.button];
      out.push([e.down ? 0x10 : 0x90, 1, 0, mask]);
      continue;
    }
    const mod = modifierBitForUsage(e.usage);
    out.push(
      mod !== undefined ? [e.down ? 0x20 : 0xa0, 1, 0, mod] : [e.down ? 0x30 : 0xb0, 1, 0, e.usage],
    );
  }
  return out.flat();
}

/** Up to 15 chunks of 27 bytes (the chunk count is four bits): the slot byte and 101 events. */
export const MAX_MACRO_EVENTS = Math.floor((15 * PAYLOAD - 1) / 4);

export const MACRO_LIMITS: MacroLimits = {
  slots: BUTTONS,
  storageBytes: BUTTONS * 15 * PAYLOAD,
  minDelayMs: 1,
  maxDelayMs: 0xffff,
};

/** `08` packets for one slot: the slot byte and the events, in 27-byte chunks. */
export function macroPackets(slot: number, m: Macro): Uint8Array[] {
  const events = macroEvents(m);
  if (events.length / 4 > MAX_MACRO_EVENTS)
    throw new ProtocolError(
      `An AJ179 macro holds at most ${MAX_MACRO_EVENTS} presses and releases.`,
    );
  const data = [slot, ...events];
  const n = Math.max(1, Math.ceil(data.length / PAYLOAD));
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const chunk = data.slice(i * PAYLOAD, (i + 1) * PAYLOAD);
    const f = new Uint8Array(REPORT_LEN);
    f.set([SET_MACRO, 0x00, (i << 4) | n, chunk.length]);
    f.set(chunk, 4);
    checksum(f);
    out.push(f);
  }
  return out;
}

/** The mouse as a layout of its six buttons (left button fixed). */
export function mouseLayout(): KeyboardLayout {
  const pos = [
    { x: 0, y: 0, w: 2, h: 3 },
    { x: 3, y: 0, w: 2, h: 3 },
    { x: 2, y: 0.5, w: 1, h: 1.5 },
    { x: 0, y: 4, w: 1.5, h: 1 },
    { x: 0, y: 3, w: 1.5, h: 1 },
    { x: 2, y: 2.25, w: 1, h: 1 },
  ];
  return {
    id: 'aj179',
    name: 'AJAZZ AJ179 (6 buttons)',
    width: 5,
    height: 5,
    keys: BUTTON_NAMES.map((label, i) => ({
      id: label.toLowerCase(),
      label,
      slot: i === LOCKED_BUTTON ? -1 : i,
      light: null,
      usage: 0,
      ...pos[i]!,
    })),
    source:
      'Rockeyxx/aj179-linux PROTOCOL.md: buttons 0–5 (left, right, middle, back, forward, DPI)',
  };
}
