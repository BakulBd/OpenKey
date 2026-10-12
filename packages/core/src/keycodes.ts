import { consumerUsages, keyboardUsages, usageName } from './hid-usages.js';
import type { KeyAction, MouseAction } from './model/keymap.js';
import { MODIFIER_BITS } from './model/keymap.js';

export type KeycodeGroup =
  | 'letters'
  | 'digits'
  | 'function'
  | 'navigation'
  | 'editing'
  | 'modifiers'
  | 'punctuation'
  | 'numpad'
  | 'media'
  | 'system'
  | 'mouse'
  | 'shortcuts'
  | 'layers'
  | 'special';

export interface KeycodeEntry {
  id: string;
  action: KeyAction;
  name: string;
  group: KeycodeGroup;
  /** QMK-style identifier where one exists (search only; OpenKey does not speak QMK here). */
  qmk?: string;
  /** Extra search terms, e.g. "letter a", "volume". */
  aliases: string[];
}

const QMK_SPECIAL: Record<number, string> = {
  0x28: 'KC_ENT',
  0x29: 'KC_ESC',
  0x2a: 'KC_BSPC',
  0x2b: 'KC_TAB',
  0x2c: 'KC_SPC',
  0x2d: 'KC_MINS',
  0x2e: 'KC_EQL',
  0x2f: 'KC_LBRC',
  0x30: 'KC_RBRC',
  0x31: 'KC_BSLS',
  0x33: 'KC_SCLN',
  0x34: 'KC_QUOT',
  0x35: 'KC_GRV',
  0x36: 'KC_COMM',
  0x37: 'KC_DOT',
  0x38: 'KC_SLSH',
  0x39: 'KC_CAPS',
  0x46: 'KC_PSCR',
  0x47: 'KC_SCRL',
  0x48: 'KC_PAUS',
  0x49: 'KC_INS',
  0x4a: 'KC_HOME',
  0x4b: 'KC_PGUP',
  0x4c: 'KC_DEL',
  0x4d: 'KC_END',
  0x4e: 'KC_PGDN',
  0x4f: 'KC_RGHT',
  0x50: 'KC_LEFT',
  0x51: 'KC_DOWN',
  0x52: 'KC_UP',
  0x65: 'KC_APP',
  0xe0: 'KC_LCTL',
  0xe1: 'KC_LSFT',
  0xe2: 'KC_LALT',
  0xe3: 'KC_LGUI',
  0xe4: 'KC_RCTL',
  0xe5: 'KC_RSFT',
  0xe6: 'KC_RALT',
  0xe7: 'KC_RGUI',
};

const QMK_CONSUMER: Record<number, string> = {
  0xe9: 'KC_VOLU',
  0xea: 'KC_VOLD',
  0xe2: 'KC_MUTE',
  0xcd: 'KC_MPLY',
  0xb5: 'KC_MNXT',
  0xb6: 'KC_MPRV',
  0xb7: 'KC_MSTP',
  0x6f: 'KC_BRIU',
  0x70: 'KC_BRID',
};

function keyboardGroup(u: number): KeycodeGroup {
  if (u >= 0x04 && u <= 0x1d) return 'letters';
  if (u >= 0x1e && u <= 0x27) return 'digits';
  if ((u >= 0x3a && u <= 0x45) || (u >= 0x68 && u <= 0x73)) return 'function';
  if (u >= 0x4a && u <= 0x52) return 'navigation';
  if (u >= 0x53 && u <= 0x63) return 'numpad';
  if (u >= 0xe0 && u <= 0xe7) return 'modifiers';
  if ([0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x39, 0x49, 0x4c, 0x46, 0x47, 0x48, 0x65].includes(u))
    return 'editing';
  return 'punctuation';
}

function qmkName(u: number): string | undefined {
  if (u >= 0x04 && u <= 0x1d) return `KC_${String.fromCharCode(65 + u - 0x04)}`;
  if (u >= 0x1e && u <= 0x26) return `KC_${u - 0x1d}`;
  if (u === 0x27) return 'KC_0';
  if (u >= 0x3a && u <= 0x45) return `KC_F${u - 0x39}`;
  if (u >= 0x68 && u <= 0x73) return `KC_F${u - 0x68 + 13}`;
  return QMK_SPECIAL[u];
}

const MOUSE: [MouseAction, string, string[]][] = [
  ['left', 'Left click', ['mouse 1', 'btn1', 'click']],
  ['right', 'Right click', ['mouse 2', 'context']],
  ['middle', 'Middle click', ['mouse 3', 'wheel click']],
  ['left+right', 'Double click', ['double']],
  ['back', 'Mouse back (button 4)', ['mouse 4', 'browser back']],
  ['forward', 'Mouse forward (button 5)', ['mouse 5', 'browser forward']],
  ['wheel-up', 'Scroll up', ['wheel']],
  ['wheel-down', 'Scroll down', ['wheel']],
];

const { LCtrl, LShift, LGui } = MODIFIER_BITS;
/** Common editing shortcuts, in Windows/Linux (Ctrl) and macOS (Cmd) forms. */
const SHORTCUTS: [string, number, number, string[]][] = [
  ['Copy', 0x06, LCtrl, ['copy', 'ctrl c']],
  ['Paste', 0x19, LCtrl, ['paste', 'ctrl v']],
  ['Cut', 0x1b, LCtrl, ['cut', 'ctrl x']],
  ['Undo', 0x1d, LCtrl, ['undo', 'ctrl z']],
  ['Redo', 0x1c, LCtrl, ['redo', 'ctrl y']],
  ['Select all', 0x04, LCtrl, ['select all', 'ctrl a']],
  ['Save', 0x16, LCtrl, ['save', 'ctrl s']],
  ['Find', 0x09, LCtrl, ['find', 'search', 'ctrl f']],
  ['Copy (macOS)', 0x06, LGui, ['copy', 'cmd c', 'mac']],
  ['Paste (macOS)', 0x19, LGui, ['paste', 'cmd v', 'mac']],
  ['Cut (macOS)', 0x1b, LGui, ['cut', 'cmd x', 'mac']],
  ['Undo (macOS)', 0x1d, LGui, ['undo', 'cmd z', 'mac']],
  ['Redo (macOS)', 0x1d, LGui | LShift, ['redo', 'cmd shift z', 'mac']],
];

let cache: KeycodeEntry[] | null = null;

/** Every action the keymap editor can offer, protocol-neutral. Adapters decide what they encode. */
export function keycodeCatalog(): KeycodeEntry[] {
  if (cache) return cache;
  const out: KeycodeEntry[] = [
    {
      id: 'default',
      action: { kind: 'default' },
      name: 'Default',
      group: 'special',
      aliases: ['reset', 'factory', 'original'],
    },
    {
      id: 'disabled',
      action: { kind: 'disabled' },
      name: 'Disabled',
      group: 'special',
      aliases: ['none', 'off', 'block', 'KC_NO'],
    },
  ];
  for (const { usage, name } of keyboardUsages()) {
    const group = keyboardGroup(usage);
    const qmk = qmkName(usage);
    const aliases = [
      group === 'letters' ? `letter ${name.toLowerCase()}` : '',
      group === 'digits' ? `number ${name}` : '',
      `0x${usage.toString(16).padStart(2, '0')}`,
    ].filter(Boolean);
    out.push({
      id: `kb-${usage}`,
      action: { kind: 'keyboard', usage, modifiers: 0 },
      name,
      group,
      ...(qmk ? { qmk } : {}),
      aliases,
    });
  }
  for (const { usage, name } of consumerUsages()) {
    const qmk = QMK_CONSUMER[usage];
    out.push({
      id: `cc-${usage}`,
      action: { kind: 'consumer', usage },
      name,
      group: 'media',
      ...(qmk ? { qmk } : {}),
      aliases: ['media', ...(/volume/i.test(name) ? ['sound', 'audio'] : [])],
    });
  }
  for (const usage of [0x81, 0x82, 0x83])
    out.push({
      id: `sys-${usage}`,
      action: { kind: 'system', usage },
      name: usageName(0x01, usage),
      group: 'system',
      aliases: ['power', 'sleep', 'system'],
    });
  for (const [action, name, aliases] of MOUSE)
    out.push({
      id: `mouse-${action}`,
      action: { kind: 'mouse', action },
      name,
      group: 'mouse',
      aliases: ['mouse', ...aliases],
    });
  for (const [name, usage, modifiers, aliases] of SHORTCUTS)
    out.push({
      id: `sc-${name}`,
      action: { kind: 'keyboard', usage, modifiers },
      name,
      group: 'shortcuts',
      aliases: ['shortcut', ...aliases],
    });
  for (let layer = 0; layer < 8; layer++) {
    out.push({
      id: `mo-${layer}`,
      action: { kind: 'layer', layer, mode: 'momentary' },
      name: `Hold for layer ${layer}`,
      group: 'layers',
      qmk: `MO(${layer})`,
      aliases: ['layer', 'momentary', 'fn'],
    });
    out.push({
      id: `tg-${layer}`,
      action: { kind: 'layer', layer, mode: 'toggle' },
      name: `Toggle layer ${layer}`,
      group: 'layers',
      qmk: `TG(${layer})`,
      aliases: ['layer', 'toggle'],
    });
  }
  cache = out;
  return out;
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();

/**
 * Ranked search over names, QMK identifiers and aliases. Exact matches first ("A" finds the A key
 * before "Caps Lock"), then prefixes, then substrings.
 */
export function searchKeycodes(
  query: string,
  entries: readonly KeycodeEntry[] = keycodeCatalog(),
): KeycodeEntry[] {
  const q = norm(query);
  if (!q) return [...entries];
  const scored: [number, KeycodeEntry][] = [];
  for (const e of entries) {
    const fields = [e.name, e.qmk ?? '', e.qmk?.replace(/^KC_/, '') ?? '', ...e.aliases].map(norm);
    let score = 0;
    for (const f of fields) {
      if (!f) continue;
      if (f === q) score = Math.max(score, 100);
      else if (f.startsWith(q)) score = Math.max(score, 60 - Math.min(f.length, 30));
      else if (f.includes(q)) score = Math.max(score, 20);
    }
    if (score > 0) scored.push([score, e]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, e]) => e);
}
