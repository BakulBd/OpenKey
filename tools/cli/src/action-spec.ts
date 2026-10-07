import { MODIFIER_BITS, describeAction, keyboardUsages, usageName } from '@openkey/core';
import type { KeyAction, KeyboardLayout, MouseAction, PhysicalKey } from '@openkey/core';

const KEY_ALIASES: Record<string, number> = {
  esc: 0x29,
  escape: 0x29,
  enter: 0x28,
  return: 0x28,
  tab: 0x2b,
  space: 0x2c,
  backspace: 0x2a,
  bksp: 0x2a,
  caps: 0x39,
  capslock: 0x39,
  del: 0x4c,
  delete: 0x4c,
  ins: 0x49,
  insert: 0x49,
  home: 0x4a,
  end: 0x4d,
  pgup: 0x4b,
  pageup: 0x4b,
  pgdn: 0x4e,
  pagedown: 0x4e,
  up: 0x52,
  down: 0x51,
  left: 0x50,
  right: 0x4f,
  minus: 0x2d,
  equal: 0x2e,
  grave: 0x35,
  menu: 0x65,
  prtsc: 0x46,
  printscreen: 0x46,
  lctrl: 0xe0,
  lshift: 0xe1,
  lalt: 0xe2,
  lgui: 0xe3,
  lwin: 0xe3,
  rctrl: 0xe4,
  rshift: 0xe5,
  ralt: 0xe6,
  rgui: 0xe7,
  rwin: 0xe7,
};
const MOD_ALIASES: Record<string, number> = {
  ctrl: MODIFIER_BITS.LCtrl,
  shift: MODIFIER_BITS.LShift,
  alt: MODIFIER_BITS.LAlt,
  win: MODIFIER_BITS.LGui,
  gui: MODIFIER_BITS.LGui,
  cmd: MODIFIER_BITS.LGui,
  rctrl: MODIFIER_BITS.RCtrl,
  rshift: MODIFIER_BITS.RShift,
  ralt: MODIFIER_BITS.RAlt,
  rgui: MODIFIER_BITS.RGui,
};
const CONSUMER_ALIASES: Record<string, number> = {
  play: 0xcd,
  playpause: 0xcd,
  stop: 0xb7,
  next: 0xb5,
  prev: 0xb6,
  previous: 0xb6,
  mute: 0xe2,
  volup: 0xe9,
  voldown: 0xea,
  calc: 0x192,
  calculator: 0x192,
  mail: 0x18a,
  browser: 0x223,
  mycomputer: 0x194,
};

export function parseKeyName(name: string): number {
  const n = name.toLowerCase();
  if (KEY_ALIASES[n] !== undefined) return KEY_ALIASES[n];
  if (/^0x[0-9a-f]+$/.test(n)) return parseInt(n, 16);
  const hit = keyboardUsages().find((u) => u.name.toLowerCase() === n);
  if (hit) return hit.usage;
  throw new Error(`Unknown key "${name}"`);
}

/**
 * Action spec grammar (CLI and docs):
 *   default | disabled | key:<k>[+<k>…] | consumer:<name|0xNN> | mouse:<left|right|middle|back|forward|wheel-up|wheel-down>
 *   macro:<slot>[:once|repeat:<n>|toggle] | raw:<hex bytes>
 * Examples: key:a, key:ctrl+c, consumer:mute, mouse:wheel-up, macro:0:repeat:3
 */
export function parseActionSpec(spec: string): KeyAction {
  const [kind, ...rest] = spec.split(':');
  const arg = rest.join(':');
  switch (kind!.toLowerCase()) {
    case 'default':
      return { kind: 'default' };
    case 'disabled':
    case 'disable':
      return { kind: 'disabled' };
    case 'key': {
      const parts = arg.split('+').filter(Boolean);
      let modifiers = 0;
      let usage = 0;
      for (const p of parts) {
        const m = MOD_ALIASES[p.toLowerCase()];
        if (m !== undefined && parts.length > 1) modifiers |= m;
        else usage = parseKeyName(p);
      }
      return { kind: 'keyboard', usage, modifiers };
    }
    case 'consumer':
    case 'media': {
      const v = CONSUMER_ALIASES[arg.toLowerCase()] ?? (/^0x/i.test(arg) ? parseInt(arg, 16) : NaN);
      if (Number.isNaN(v)) throw new Error(`Unknown consumer usage "${arg}"`);
      return { kind: 'consumer', usage: v };
    }
    case 'mouse':
      return { kind: 'mouse', action: arg as MouseAction };
    case 'macro': {
      const [slot, mode = 'once', count = '1'] = arg.split(':');
      return {
        kind: 'macro',
        index: Number(slot),
        mode: mode as 'once' | 'repeat' | 'toggle',
        repeat: Number(count),
      };
    }
    case 'raw':
      return {
        kind: 'raw',
        bytes: arg
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((h) => parseInt(h, 16)),
      };
    default:
      throw new Error(`Unknown action kind "${kind}"`);
  }
}

export function findKey(layout: KeyboardLayout, name: string): PhysicalKey {
  const n = name.toLowerCase();
  const bySlot = /^#?(\d+)$/.exec(n);
  const k =
    (bySlot && layout.keys.find((x) => x.slot === Number(bySlot[1]))) ||
    layout.keys.find((x) => x.label.toLowerCase() === n || x.id.toLowerCase() === n) ||
    layout.keys.find((x) => usageName(0x07, x.usage).toLowerCase() === n);
  if (!k)
    throw new Error(
      `No key "${name}" in layout ${layout.id} (use a label like "Caps" or a slot like "#55")`,
    );
  return k;
}

export function formatAction(a: KeyAction): string {
  return describeAction(a, usageName);
}
