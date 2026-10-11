/**
 * Protocol-neutral key action model. Protocol adapters translate these to and from their
 * on-wire slot encodings; the UI never sees wire bytes.
 */

export type MouseAction =
  'left' | 'right' | 'middle' | 'back' | 'forward' | 'wheel-up' | 'wheel-down' | 'left+right';

export type MacroPlayMode = 'once' | 'repeat' | 'toggle' | 'while-held';

export type KeyAction =
  /** The firmware's factory function for this position. */
  | { kind: 'default' }
  | { kind: 'disabled' }
  /** HID Keyboard/Keypad page (0x07) usage plus modifier bitmask (bit0 LCtrl … bit7 RGUI). */
  | { kind: 'keyboard'; usage: number; modifiers: number }
  /** HID Consumer page (0x0C) usage, e.g. 0xCD play/pause. */
  | { kind: 'consumer'; usage: number }
  /** HID Generic Desktop system control usage, e.g. 0x82 sleep. */
  | { kind: 'system'; usage: number }
  | { kind: 'mouse'; action: MouseAction }
  | { kind: 'macro'; index: number; mode: MacroPlayMode; repeat: number }
  | { kind: 'layer'; layer: number; mode: 'momentary' | 'toggle' }
  /** Vendor function (lighting control, profile switch …) identified by a protocol-specific code. */
  | { kind: 'special'; code: number; label?: string }
  /** Encoding OpenKey does not understand; preserved byte-for-byte. */
  | { kind: 'raw'; bytes: number[] };

/** `base` and `fn` for two-layer boards; `layer2`, `layer3` … for firmware with more layers. */
export type LayerId = 'base' | 'fn' | `layer${number}`;

/** 0 for base, 1 for fn, n for `layer<n>`. */
export function layerIndex(id: LayerId): number {
  return id === 'base' ? 0 : id === 'fn' ? 1 : Number(id.slice(5));
}

export function layerIdAt(n: number): LayerId {
  return n === 0 ? 'base' : n === 1 ? 'fn' : `layer${n}`;
}

export type KeyActionKind = KeyAction['kind'];

/** A keymap is a sparse mapping of firmware slot index → action. Missing slots mean `default`. */
export interface KeymapState {
  layer: LayerId;
  slots: Record<number, KeyAction>;
  /** `device` when read back from firmware; `mirror` when reconstructed from OpenKey's last write. */
  provenance: 'device' | 'mirror' | 'assumed-default';
  updatedAt?: string;
}

export const MODIFIER_BITS = {
  LCtrl: 0x01,
  LShift: 0x02,
  LAlt: 0x04,
  LGui: 0x08,
  RCtrl: 0x10,
  RShift: 0x20,
  RAlt: 0x40,
  RGui: 0x80,
} as const;

/** HID usages 0xE0..0xE7 are modifier keys; this maps them to their bitmask. */
export function modifierBitForUsage(usage: number): number | undefined {
  if (usage >= 0xe0 && usage <= 0xe7) return 1 << (usage - 0xe0);
  return undefined;
}

export function actionsEqual(a: KeyAction, b: KeyAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function describeAction(
  a: KeyAction,
  usageName: (page: number, usage: number) => string,
): string {
  switch (a.kind) {
    case 'default':
      return 'Default';
    case 'disabled':
      return 'Disabled';
    case 'keyboard': {
      const mods = Object.entries(MODIFIER_BITS)
        .filter(([, bit]) => (a.modifiers & bit) !== 0)
        .map(([name]) => name);
      const key = a.usage ? usageName(0x07, a.usage) : '';
      return [...mods, key].filter(Boolean).join('+') || 'None';
    }
    case 'consumer':
      return usageName(0x0c, a.usage);
    case 'system':
      return usageName(0x01, a.usage);
    case 'mouse':
      return `Mouse ${a.action}`;
    case 'macro':
      return `Macro ${a.index + 1} (${a.mode}${a.mode === 'repeat' ? ` ×${a.repeat}` : ''})`;
    case 'layer':
      return `Layer ${a.layer} (${a.mode})`;
    case 'special':
      return a.label ?? `Special 0x${a.code.toString(16)}`;
    case 'raw':
      return `Raw ${a.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
  }
}
