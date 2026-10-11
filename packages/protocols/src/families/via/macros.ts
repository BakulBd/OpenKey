import type { Macro, MacroEvent } from '@openkey/core';
import type { KeycodeVersion } from './keycodes.js';

/**
 * VIA macro storage: one buffer holding every macro as a NUL-terminated string (QMK
 * `dynamic_keymap_macro_send`, `send_string_with_delay_impl`). Printable ASCII is typed as text;
 * `01 01 kc` taps, `01 02 kc` presses, `01 03 kc` releases a basic keycode, and `01 04 <digits> |`
 * waits. OpenKey writes only press/release/wait records, so what is stored is exactly what plays.
 */
const PREFIX = 0x01;
const TAP = 0x01;
const DOWN = 0x02;
const UP = 0x03;
const DELAY = 0x04;

/** US-layout characters → [HID usage, shifted]. */
const ASCII = new Map<string, [number, boolean]>();
for (let i = 0; i < 26; i++) {
  ASCII.set(String.fromCharCode(97 + i), [0x04 + i, false]);
  ASCII.set(String.fromCharCode(65 + i), [0x04 + i, true]);
}
'1234567890'.split('').forEach((c, i) => ASCII.set(c, [0x1e + i, false]));
'!@#$%^&*()'.split('').forEach((c, i) => ASCII.set(c, [0x1e + i, true]));
for (const [plain, shifted, usage] of [
  ['-', '_', 0x2d], ['=', '+', 0x2e], ['[', '{', 0x2f], [']', '}', 0x30], ['\\', '|', 0x31], [';', ':', 0x33],
  ["'", '"', 0x34], ['`', '~', 0x35], [',', '<', 0x36], ['.', '>', 0x37], ['/', '?', 0x38],
] as const) {
  ASCII.set(plain, [usage, false]);
  ASCII.set(shifted, [usage, true]);
}
ASCII.set(' ', [0x2c, false]);
ASCII.set('\n', [0x28, false]);
ASCII.set('\t', [0x2b, false]);
const LSHIFT = 0xe1;

const MOUSE: Record<KeycodeVersion, Record<'left' | 'right' | 'middle', number>> = {
  2: { left: 0xd1, right: 0xd2, middle: 0xd3 },
  1: { left: 0xf4, right: 0xf5, middle: 0xf6 },
};

function keyEvents(code: number, kind: number, v: KeycodeVersion): MacroEvent[] {
  const mouse = (Object.entries(MOUSE[v]) as ['left' | 'right' | 'middle', number][]).find(([, c]) => c === code);
  const ev = (down: boolean): MacroEvent => (mouse ? { type: 'mouse', button: mouse[0], down } : { type: 'key', usage: code, down });
  return kind === TAP ? [ev(true), ev(false)] : [ev(kind === DOWN)];
}

export function decodeMacros(buf: Uint8Array, count: number, v: KeycodeVersion): Macro[] {
  const out: Macro[] = [];
  let i = 0;
  for (let index = 0; index < count; index++) {
    const events: MacroEvent[] = [];
    while (i < buf.length && buf[i] !== 0) {
      const b = buf[i++]!;
      if (b === PREFIX) {
        const kind = buf[i++];
        if (kind === TAP || kind === DOWN || kind === UP) events.push(...keyEvents(buf[i++] ?? 0, kind, v));
        else if (kind === DELAY) {
          let ms = 0;
          while (i < buf.length && buf[i]! >= 0x30 && buf[i]! <= 0x39) ms = ms * 10 + (buf[i++]! - 0x30);
          if (buf[i] === 0x7c) i++;
          events.push({ type: 'delay', ms });
        }
        continue;
      }
      const k = ASCII.get(String.fromCharCode(b));
      if (!k) continue;
      if (k[1]) events.push({ type: 'key', usage: LSHIFT, down: true });
      events.push({ type: 'key', usage: k[0], down: true }, { type: 'key', usage: k[0], down: false });
      if (k[1]) events.push({ type: 'key', usage: LSHIFT, down: false });
    }
    i++; // the terminating NUL
    out.push({ index, events });
  }
  return out;
}

export function encodeMacros(macros: Macro[], count: number, size: number, v: KeycodeVersion): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < count; index++) {
    const m = macros.find((x) => x.index === index);
    for (const e of m?.events ?? []) {
      if (e.type === 'delay') bytes.push(PREFIX, DELAY, ...[...String(Math.max(0, Math.round(e.ms)))].map((c) => c.charCodeAt(0)), 0x7c);
      else if (e.type === 'key') bytes.push(PREFIX, e.down ? DOWN : UP, e.usage & 0xff);
      else bytes.push(PREFIX, e.down ? DOWN : UP, MOUSE[v][e.button]);
    }
    bytes.push(0);
  }
  if (bytes.length > size) throw new RangeError(`Macros need ${bytes.length} bytes; the keyboard stores ${size}.`);
  const out = new Uint8Array(size);
  out.set(bytes);
  return out;
}
