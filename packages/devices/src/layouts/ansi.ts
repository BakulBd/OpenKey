import type { KeyboardLayout, PhysicalKey } from '@openkey/core';

/**
 * Standard ANSI geometry (key units, the usual KLE positions) for keyboards whose protocol gives LED
 * or key indices but no picture. Every key has a stable name; an adapter maps names to its own LED
 * and matrix indices, so the geometry is shared and the protocol facts stay in the adapter.
 */
export interface AnsiKey {
  name: string;
  label: string;
  usage: number;
  x: number;
  y: number;
  w?: number;
  h?: number;
}

const k = (
  name: string,
  usage: number,
  x: number,
  y: number,
  w = 1,
  h = 1,
  label = name,
): AnsiKey => ({
  name,
  label,
  usage,
  x,
  y,
  w,
  h,
});

const row = (y: number, x0: number, keys: [string, number][]): AnsiKey[] =>
  keys.map(([n, u], i) => k(n, u, x0 + i, y));

/** The 87 keys of an ANSI tenkeyless board. `Fn` replaces the right Win key, as on most gaming boards. */
function tkl(rightMods: 'win' | 'fn'): AnsiKey[] {
  return [
    k('Esc', 0x29, 0, 0),
    ...row(0, 2, [
      ['F1', 0x3a],
      ['F2', 0x3b],
      ['F3', 0x3c],
      ['F4', 0x3d],
    ]),
    ...row(0, 6.5, [
      ['F5', 0x3e],
      ['F6', 0x3f],
      ['F7', 0x40],
      ['F8', 0x41],
    ]),
    ...row(0, 11, [
      ['F9', 0x42],
      ['F10', 0x43],
      ['F11', 0x44],
      ['F12', 0x45],
    ]),
    k('PrtSc', 0x46, 15.25, 0),
    k('ScrLk', 0x47, 16.25, 0),
    k('Pause', 0x48, 17.25, 0),

    ...row(1.25, 0, [
      ['`', 0x35],
      ['1', 0x1e],
      ['2', 0x1f],
      ['3', 0x20],
      ['4', 0x21],
      ['5', 0x22],
      ['6', 0x23],
      ['7', 0x24],
      ['8', 0x25],
      ['9', 0x26],
      ['0', 0x27],
      ['-', 0x2d],
      ['=', 0x2e],
    ]),
    k('Backspace', 0x2a, 13, 1.25, 2),
    k('Ins', 0x49, 15.25, 1.25),
    k('Home', 0x4a, 16.25, 1.25),
    k('PgUp', 0x4b, 17.25, 1.25),

    k('Tab', 0x2b, 0, 2.25, 1.5),
    ...row(2.25, 1.5, [
      ['Q', 0x14],
      ['W', 0x1a],
      ['E', 0x08],
      ['R', 0x15],
      ['T', 0x17],
      ['Y', 0x1c],
      ['U', 0x18],
      ['I', 0x0c],
      ['O', 0x12],
      ['P', 0x13],
      ['[', 0x2f],
      [']', 0x30],
    ]),
    k('\\', 0x31, 13.5, 2.25, 1.5),
    k('Del', 0x4c, 15.25, 2.25),
    k('End', 0x4d, 16.25, 2.25),
    k('PgDn', 0x4e, 17.25, 2.25),

    k('Caps', 0x39, 0, 3.25, 1.75),
    ...row(3.25, 1.75, [
      ['A', 0x04],
      ['S', 0x16],
      ['D', 0x07],
      ['F', 0x09],
      ['G', 0x0a],
      ['H', 0x0b],
      ['J', 0x0d],
      ['K', 0x0e],
      ['L', 0x0f],
      [';', 0x33],
      ["'", 0x34],
    ]),
    k('Enter', 0x28, 12.75, 3.25, 2.25),

    k('LShift', 0xe1, 0, 4.25, 2.25, 1, 'Shift'),
    ...row(4.25, 2.25, [
      ['Z', 0x1d],
      ['X', 0x1b],
      ['C', 0x06],
      ['V', 0x19],
      ['B', 0x05],
      ['N', 0x11],
      ['M', 0x10],
      [',', 0x36],
      ['.', 0x37],
      ['/', 0x38],
    ]),
    k('RShift', 0xe5, 12.25, 4.25, 2.75, 1, 'Shift'),
    k('Up', 0x52, 16.25, 4.25, 1, 1, '↑'),

    k('LCtrl', 0xe0, 0, 5.25, 1.25, 1, 'Ctrl'),
    k('LWin', 0xe3, 1.25, 5.25, 1.25, 1, 'Win'),
    k('LAlt', 0xe2, 2.5, 5.25, 1.25, 1, 'Alt'),
    k('Space', 0x2c, 3.75, 5.25, 6.25),
    k('RAlt', 0xe6, 10, 5.25, 1.25, 1, 'Alt'),
    rightMods === 'fn'
      ? k('Fn', 0, 11.25, 5.25, 1.25)
      : k('RWin', 0xe7, 11.25, 5.25, 1.25, 1, 'Win'),
    k('Menu', 0x65, 12.5, 5.25, 1.25),
    k('RCtrl', 0xe4, 13.75, 5.25, 1.25, 1, 'Ctrl'),
    k('Left', 0x50, 15.25, 5.25, 1, 1, '←'),
    k('Down', 0x51, 16.25, 5.25, 1, 1, '↓'),
    k('Right', 0x4f, 17.25, 5.25, 1, 1, '→'),
  ];
}

/** The 17-key number pad right of a TKL block. */
function numpad(): AnsiKey[] {
  const x = 18.5;
  return [
    k('NumLock', 0x53, x, 1.25, 1, 1, 'Num'),
    k('KP/', 0x54, x + 1, 1.25, 1, 1, '/'),
    k('KP*', 0x55, x + 2, 1.25, 1, 1, '*'),
    k('KP-', 0x56, x + 3, 1.25, 1, 1, '-'),
    k('KP7', 0x5f, x, 2.25, 1, 1, '7'),
    k('KP8', 0x60, x + 1, 2.25, 1, 1, '8'),
    k('KP9', 0x61, x + 2, 2.25, 1, 1, '9'),
    k('KP+', 0x57, x + 3, 2.25, 1, 2, '+'),
    k('KP4', 0x5c, x, 3.25, 1, 1, '4'),
    k('KP5', 0x5d, x + 1, 3.25, 1, 1, '5'),
    k('KP6', 0x5e, x + 2, 3.25, 1, 1, '6'),
    k('KP1', 0x59, x, 4.25, 1, 1, '1'),
    k('KP2', 0x5a, x + 1, 4.25, 1, 1, '2'),
    k('KP3', 0x5b, x + 2, 4.25, 1, 1, '3'),
    k('KPEnter', 0x58, x + 3, 4.25, 1, 2, 'Ent'),
    k('KP0', 0x62, x, 5.25, 2, 1, '0'),
    k('KP.', 0x63, x + 2, 5.25, 1, 1, '.'),
  ];
}

export type AnsiSize = 'tkl' | 'full';

export function ansiKeys(size: AnsiSize, rightMods: 'win' | 'fn' = 'fn'): AnsiKey[] {
  return size === 'full' ? [...tkl(rightMods), ...numpad()] : tkl(rightMods);
}

export interface AnsiLayoutOptions {
  id: string;
  name: string;
  size: AnsiSize;
  rightMods?: 'win' | 'fn';
  /** LED index of a key by name; null when the key has no LED or the index is unknown. */
  light: (name: string) => number | null;
  /** Matrix slot by name; defaults to the LED index (or -1). */
  slot?: (name: string) => number;
  /** Extra keys outside the standard block (media keys, knobs …). */
  extraKeys?: AnsiKey[];
  source: string;
}

/** A layout from the standard geometry; keys the adapter has no LED for keep `light: null`. */
export function ansiLayout(o: AnsiLayoutOptions): KeyboardLayout {
  const keys: PhysicalKey[] = [];
  for (const a of [...ansiKeys(o.size, o.rightMods), ...(o.extraKeys ?? [])]) {
    const light = o.light(a.name);
    const slot = o.slot ? o.slot(a.name) : (light ?? -1);
    keys.push({
      id: a.name,
      label: a.label,
      slot,
      light,
      usage: a.usage,
      x: a.x,
      y: a.y,
      w: a.w ?? 1,
      h: a.h ?? 1,
    });
  }
  const width = Math.max(...keys.map((k) => k.x + k.w));
  const height = Math.max(...keys.map((k) => k.y + k.h));
  return { id: o.id, name: o.name, width, height, keys, source: o.source };
}
