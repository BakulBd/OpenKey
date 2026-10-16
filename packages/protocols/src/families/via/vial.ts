import { ProtocolError } from '@openkey/core';
import { parseDefinition } from './definition.js';
import type { ViaDefinition } from './definition.js';
import type { ViaSession } from './session.js';
import { XzError, decompressXz } from './xz.js';

/**
 * Vial: QMK firmware that keeps its own keyboard definition (vial.json, XZ-compressed) and answers
 * VIA commands. Facts from vial-kb/vial-qmk quantum/vial.c, vial.h, qmk_settings.c and vial-gui
 * (GPL-2.0; facts only). Vial commands share VIA's raw HID report with prefix 0xFE; their replies
 * carry data from byte 0 instead of echoing the command.
 *
 * OpenKey sends the reads, the QMK-settings write and the tap dance / combo / key override writes
 * (the firmware itself refuses QK_BOOT in them while the board is locked). The settings reset,
 * unlock, lock and Vial's own encoder commands are never sent; knobs use VIA's encoder commands.
 */
export const VIAL_PREFIX = 0xfe;
export const VialCmd = {
  GET_KEYBOARD_ID: 0x00,
  GET_SIZE: 0x01,
  GET_DEFINITION: 0x02,
  QMK_SETTINGS_QUERY: 0x09,
  QMK_SETTINGS_GET: 0x0a,
  QMK_SETTINGS_SET: 0x0b,
  DYNAMIC_ENTRY_OP: 0x0d,
} as const;
/** Never sent: they reset all QMK settings, or lock/unlock and remap knobs outside VIA's commands. */
export const VIAL_FORBIDDEN = {
  GET_ENCODER: 0x03,
  SET_ENCODER: 0x04,
  UNLOCK_STATUS: 0x05,
  UNLOCK_START: 0x06,
  UNLOCK_POLL: 0x07,
  LOCK: 0x08,
  QMK_SETTINGS_RESET: 0x0c,
} as const;
/** Sub-commands of DYNAMIC_ENTRY_OP. */
export const DynamicOp = {
  COUNTS: 0x00,
  TAP_DANCE_GET: 0x01,
  TAP_DANCE_SET: 0x02,
  COMBO_GET: 0x03,
  COMBO_SET: 0x04,
  KEY_OVERRIDE_GET: 0x05,
  KEY_OVERRIDE_SET: 0x06,
} as const;
/** USB serial-number marker Vial firmware sets (vial-gui finds boards by it). WebHID cannot see it. */
export const VIAL_SERIAL_MAGIC = 'vial:f64c2b3c';
/** Definitions are a few kilobytes; anything far larger is not a Vial definition. */
const MAX_DEFINITION_BYTES = 64 * 1024;
const PAGE = 32;

export interface VialInfo {
  protocol: number;
  /** 8-byte keyboard UID as hex. */
  uid: string;
  vialRgb: boolean;
}

const u32 = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/**
 * Vial keyboard id, or null when the firmware is not Vial (plain VIA answers 0xFE as unhandled:
 * byte 0 = 0xFF, the rest of the request echoed).
 */
export async function vialKeyboardId(s: ViaSession): Promise<VialInfo | null> {
  const r = await s.vialRead([VIAL_PREFIX, VialCmd.GET_KEYBOARD_ID]);
  if (!r || r[0] === 0xff) return null;
  const protocol = u32(r, 0);
  // Vial protocol versions are small numbers; anything else is not a Vial answer.
  if (protocol > 0xff) return null;
  const uid = [...r.subarray(4, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { protocol, uid, vialRgb: r[12] === 1 };
}

/** Reads, decompresses and parses the keyboard's own definition. */
export async function vialDefinition(s: ViaSession): Promise<ViaDefinition> {
  const sizeReply = await s.vialRead([VIAL_PREFIX, VialCmd.GET_SIZE]);
  const size = sizeReply ? u32(sizeReply, 0) : 0;
  if (!size || size > MAX_DEFINITION_BYTES)
    throw new ProtocolError(`The keyboard reports an implausible definition size (${size} bytes).`);
  const data = new Uint8Array(size);
  for (let page = 0; page * PAGE < size; page++) {
    const r = await s.vialRead([VIAL_PREFIX, VialCmd.GET_DEFINITION, page & 0xff, page >> 8]);
    if (!r) throw new ProtocolError(`No answer for definition page ${page}.`);
    data.set(r.subarray(0, Math.min(PAGE, size - page * PAGE)), page * PAGE);
  }
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(decompressXz(data, 1 << 20));
  } catch (e) {
    throw new ProtocolError(
      `The keyboard's definition could not be unpacked: ${e instanceof XzError || e instanceof TypeError ? e.message : String(e)}`,
    );
  }
  return parseDefinition(json);
}

// ---------------------------------------------------------------- QMK settings

const u16 = (b: ArrayLike<number>, at: number) => (b[at]! | (b[at + 1]! << 8)) & 0xffff;
const le = (v: number, width: number) =>
  Array.from({ length: width }, (_, i) => (v >>> (8 * i)) & 0xff);

/** Setting ids the firmware has (paged query; the list ends at 0xFFFF). */
export async function qmkSettingIds(s: ViaSession): Promise<number[]> {
  const out: number[] = [];
  let after = 0;
  // A stuck firmware cannot keep this loop going: there are fewer than 256 settings.
  for (let guard = 0; guard < 64; guard++) {
    const r = await s.vialRead([VIAL_PREFIX, VialCmd.QMK_SETTINGS_QUERY, after & 0xff, after >> 8]);
    if (!r) break;
    let done = false;
    for (let i = 0; i + 1 < r.length; i += 2) {
      const id = u16(r, i);
      if (id === 0xffff) {
        done = true;
        break;
      }
      out.push(id);
      after = id;
    }
    if (done) break;
  }
  return out;
}

export async function qmkSettingGet(
  s: ViaSession,
  id: number,
  width: number,
): Promise<number | null> {
  const r = await s.vialRead([VIAL_PREFIX, VialCmd.QMK_SETTINGS_GET, id & 0xff, id >> 8]);
  if (!r || r[0] !== 0) return null;
  let v = 0;
  for (let i = width - 1; i >= 0; i--) v = v * 256 + r[1 + i]!;
  return v;
}

export async function qmkSettingSet(
  s: ViaSession,
  id: number,
  width: number,
  value: number,
): Promise<void> {
  const r = await s.vialWrite([
    VIAL_PREFIX,
    VialCmd.QMK_SETTINGS_SET,
    id & 0xff,
    id >> 8,
    ...le(value, width),
  ]);
  if (r[0] !== 0) throw new ProtocolError(`The keyboard refused QMK setting ${id}.`);
}

/**
 * The QMK settings OpenKey knows how to show: setting id, value width in bytes, and either a bit of a
 * flags value or an integer range. Ids and sizes are facts from vial-gui's qmk_settings.json; the
 * labels are OpenKey's own.
 */
export interface QmkSettingField {
  id: number;
  width: number;
  label: string;
  bit?: number;
  min?: number;
  max?: number;
  unit?: string;
}
export interface QmkSettingGroup {
  group: string;
  fields: QmkSettingField[];
}

const flag = (id: number, bit: number, label: string, width = 1): QmkSettingField => ({
  id,
  width,
  bit,
  label,
});
const int = (
  id: number,
  width: number,
  min: number,
  max: number,
  label: string,
  unit = ' ms',
): QmkSettingField => ({
  id,
  width,
  min,
  max,
  label,
  ...(unit ? { unit } : {}),
});

export const QMK_SETTINGS: readonly QmkSettingGroup[] = [
  {
    group: 'Modifier swaps (Magic)',
    fields: [
      flag(21, 0, 'Swap Caps Lock and left Ctrl', 4),
      flag(21, 1, 'Caps Lock acts as Ctrl', 4),
      flag(21, 2, 'Swap left Alt and GUI', 4),
      flag(21, 3, 'Swap right Alt and GUI', 4),
      flag(21, 4, 'Turn off the GUI keys', 4),
      flag(21, 5, 'Swap ` and Esc', 4),
      flag(21, 6, 'Swap \\ and Backspace', 4),
      flag(21, 7, 'N-key rollover', 4),
      flag(21, 8, 'Swap left Ctrl and GUI', 4),
      flag(21, 9, 'Swap right Ctrl and GUI', 4),
    ],
  },
  {
    group: 'Grave Escape',
    fields: [
      flag(1, 0, 'Esc while Alt is held'),
      flag(1, 1, 'Esc while Ctrl is held'),
      flag(1, 2, 'Esc while GUI is held'),
      flag(1, 3, 'Esc while Shift is held'),
    ],
  },
  {
    group: 'Tap and hold',
    fields: [
      int(7, 2, 0, 10000, 'Tapping term'),
      flag(8, 0, 'Permissive hold (legacy flag)'),
      flag(8, 1, 'Ignore mod-tap interrupt (legacy flag)'),
      flag(8, 2, 'Tapping force hold (legacy flag)'),
      flag(8, 3, 'Retro tapping (legacy flag)'),
      flag(22, 0, 'Permissive hold'),
      flag(23, 0, 'Hold when another key is pressed'),
      flag(24, 0, 'Retro tapping'),
      int(25, 2, 0, 10000, 'Quick tap term'),
      int(18, 2, 0, 1000, 'Delay between tap codes'),
      int(19, 2, 0, 1000, 'Caps Lock tap delay'),
      int(20, 1, 0, 100, 'Taps to toggle', ''),
      flag(26, 0, 'Chordal hold'),
      int(27, 2, 0, 10000, 'Flow tap'),
    ],
  },
  {
    group: 'Auto Shift',
    fields: [
      flag(3, 0, 'Auto Shift'),
      flag(3, 1, 'Also for modifiers'),
      int(4, 2, 0, 1000, 'Hold time before shifting'),
      flag(3, 2, 'Skip special keys'),
      flag(3, 3, 'Skip number keys'),
      flag(3, 4, 'Skip letters'),
      flag(3, 5, 'Repeat when held'),
      flag(3, 6, 'No repeat after the timeout'),
    ],
  },
  { group: 'Combos', fields: [int(2, 2, 0, 10000, 'Combo time window')] },
  {
    group: 'One-shot keys',
    fields: [
      int(5, 1, 0, 50, 'Taps that lock a one-shot key', ''),
      int(6, 2, 0, 60000, 'One-shot timeout'),
    ],
  },
  {
    group: 'Mouse keys',
    fields: [
      int(9, 2, 0, 10000, 'Delay before the cursor moves'),
      int(10, 2, 0, 10000, 'Time between cursor steps'),
      int(11, 2, 0, 1000, 'Step size', ''),
      int(12, 2, 0, 1000, 'Top cursor speed', ''),
      int(13, 2, 0, 1000, 'Time to top cursor speed', ''),
      int(14, 2, 0, 10000, 'Delay before the wheel moves'),
      int(15, 2, 0, 10000, 'Time between wheel steps'),
      int(16, 2, 0, 1000, 'Top wheel speed', ''),
      int(17, 2, 0, 1000, 'Time to top wheel speed', ''),
    ],
  },
];

// ---------------------------------------------------------------- dynamic entries

export interface VialCounts {
  tapDance: number;
  combos: number;
  keyOverrides: number;
  capsWord: boolean;
  layerLock: boolean;
}

/** Five 16-bit keycodes per tap dance: tap, hold, double tap, tap-then-hold, and its tapping term (ms). */
export interface TapDance {
  onTap: number;
  onHold: number;
  onDoubleTap: number;
  onTapHold: number;
  tappingTerm: number;
}
/** Up to four keys pressed together send the output keycode (0 = unused input). */
export interface Combo {
  input: [number, number, number, number];
  output: number;
}
/** Trigger keycode with trigger modifiers is replaced by the replacement keycode on the given layers. */
export interface KeyOverride {
  trigger: number;
  replacement: number;
  layers: number;
  triggerMods: number;
  negativeModMask: number;
  suppressedMods: number;
  options: number;
}
/** KeyOverride.options bit 7: the override is active. */
export const KEY_OVERRIDE_ENABLED = 0x80;

export async function vialCounts(s: ViaSession): Promise<VialCounts> {
  const r = await s.vialRead([VIAL_PREFIX, VialCmd.DYNAMIC_ENTRY_OP, DynamicOp.COUNTS]);
  if (!r) return { tapDance: 0, combos: 0, keyOverrides: 0, capsWord: false, layerLock: false };
  return {
    tapDance: r[0]!,
    combos: r[1]!,
    keyOverrides: r[2]!,
    capsWord: (r[31]! & 1) === 1,
    layerLock: (r[31]! & 2) === 2,
  };
}

async function entryGet(s: ViaSession, op: number, index: number): Promise<number[]> {
  const r = await s.vialRead([VIAL_PREFIX, VialCmd.DYNAMIC_ENTRY_OP, op, index]);
  if (!r || r[0] !== 0) throw new ProtocolError(`The keyboard did not return entry ${index}.`);
  return Array.from(r.subarray(1, 11));
}

async function entrySet(s: ViaSession, op: number, index: number, data: number[]): Promise<void> {
  const r = await s.vialWrite([VIAL_PREFIX, VialCmd.DYNAMIC_ENTRY_OP, op, index, ...data]);
  if (r[0] !== 0) throw new ProtocolError(`The keyboard refused entry ${index}.`);
}

const words = (b: number[], n: number) => Array.from({ length: n }, (_, i) => u16(b, i * 2));
const pack = (ws: number[]) => ws.flatMap((w) => le(w, 2));

export const tapDanceCodec = {
  decode: (b: number[]): TapDance => {
    const [onTap, onHold, onDoubleTap, onTapHold, tappingTerm] = words(b, 5) as [
      number,
      number,
      number,
      number,
      number,
    ];
    return { onTap, onHold, onDoubleTap, onTapHold, tappingTerm };
  },
  encode: (t: TapDance) => pack([t.onTap, t.onHold, t.onDoubleTap, t.onTapHold, t.tappingTerm]),
};
export const comboCodec = {
  decode: (b: number[]): Combo => {
    const w = words(b, 5);
    return { input: [w[0]!, w[1]!, w[2]!, w[3]!], output: w[4]! };
  },
  encode: (c: Combo) => pack([...c.input, c.output]),
};
export const keyOverrideCodec = {
  decode: (b: number[]): KeyOverride => ({
    trigger: u16(b, 0),
    replacement: u16(b, 2),
    layers: u16(b, 4),
    triggerMods: b[6]!,
    negativeModMask: b[7]!,
    suppressedMods: b[8]!,
    options: b[9]!,
  }),
  encode: (k: KeyOverride) => [
    ...pack([k.trigger, k.replacement, k.layers]),
    k.triggerMods,
    k.negativeModMask,
    k.suppressedMods,
    k.options,
  ],
};

export const getTapDance = async (s: ViaSession, i: number) =>
  tapDanceCodec.decode(await entryGet(s, DynamicOp.TAP_DANCE_GET, i));
export const setTapDance = (s: ViaSession, i: number, t: TapDance) =>
  entrySet(s, DynamicOp.TAP_DANCE_SET, i, tapDanceCodec.encode(t));
export const getCombo = async (s: ViaSession, i: number) =>
  comboCodec.decode(await entryGet(s, DynamicOp.COMBO_GET, i));
export const setCombo = (s: ViaSession, i: number, c: Combo) =>
  entrySet(s, DynamicOp.COMBO_SET, i, comboCodec.encode(c));
export const getKeyOverride = async (s: ViaSession, i: number) =>
  keyOverrideCodec.decode(await entryGet(s, DynamicOp.KEY_OVERRIDE_GET, i));
export const setKeyOverride = (s: ViaSession, i: number, k: KeyOverride) =>
  entrySet(s, DynamicOp.KEY_OVERRIDE_SET, i, keyOverrideCodec.encode(k));
