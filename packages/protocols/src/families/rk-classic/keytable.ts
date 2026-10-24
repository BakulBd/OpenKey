import { ProtocolError, modifierBitForUsage } from '@openkey/core';
import type { KeyAction, KeyboardLayout, PerKeyRgb, PhysicalKey } from '@openkey/core';

/**
 * Key maps and per-key colours of classic RK boards. Facts from rnayabed/rangoli
 * (keyboardconfiguratorcontroller.cpp, keycode.h; GPL-3.0) and vinc3m1/kludgeknight (BufferCodec,
 * LightingCodec, keycode.ts; GPL-3.0), facts only; the per-model key tables are RK's own KB.ini
 * (see tools/rk-keys). Key maps were tested by kludgeknight's author on an RK F68 and S79.
 *
 * Key map: the whole table in 9 reports (`09 n` header; the first adds `01 F8`), 4 bytes per key at
 * `index × 4`, big-endian. A key's code is `modifier mask << 16 | HID usage << 8`, a media key
 * `0x01000000 | consumer usage`, the Fn key `0xB000`.
 *
 * Per-key colours: the RGB "Custom" effect (14) is selected with the lighting report, then 7 reports
 * (`07 n` header; the first adds `03 7E 01`) carry R, G, B at `index × 3`.
 */
/** Report payload after the report ID (0x0A). */
const REPORT_BYTES = 64;
export const KEYMAP_REPORTS = 9;
export const COLOR_REPORTS = 7;
export const CUSTOM_EFFECT = 14;
export const FN_CODE = 0xb000;
const CONSUMER = 0x01000000;

/** Windows virtual-key code → [HID keyboard usage (or consumer usage for media keys), label]. */
const VK: Record<number, readonly [number, string, 'consumer'?]> = {
  0x08: [0x2a, 'Backspace'],
  0x09: [0x2b, 'Tab'],
  0x0d: [0x28, 'Enter'],
  0x13: [0x48, 'Pause'],
  0x14: [0x39, 'Caps'],
  0x1b: [0x29, 'Esc'],
  0x20: [0x2c, 'Space'],
  0x21: [0x4b, 'PgUp'],
  0x22: [0x4e, 'PgDn'],
  0x23: [0x4d, 'End'],
  0x24: [0x4a, 'Home'],
  0x25: [0x50, '←'],
  0x26: [0x52, '↑'],
  0x27: [0x4f, '→'],
  0x28: [0x51, '↓'],
  0x2c: [0x46, 'PrtSc'],
  0x2d: [0x49, 'Ins'],
  0x2e: [0x4c, 'Del'],
  0x5b: [0xe3, 'Win'],
  0x5c: [0xe7, 'Win'],
  0x5d: [0x65, 'Menu'],
  0x60: [0x62, 'Num 0'],
  0x6a: [0x55, 'Num *'],
  0x6b: [0x57, 'Num +'],
  0x6d: [0x56, 'Num -'],
  0x6e: [0x63, 'Num .'],
  0x6f: [0x54, 'Num /'],
  0x8d: [0xe9, 'Vol +', 'consumer'],
  0x8e: [0xea, 'Vol −', 'consumer'],
  0x8f: [0xe2, 'Mute', 'consumer'],
  0x90: [0x53, 'Num Lock'],
  0x91: [0x47, 'ScrLk'],
  0x99: [0x192, 'Calc', 'consumer'],
  0xa0: [0xe1, 'Shift'],
  0xa1: [0xe5, 'Shift'],
  0xa2: [0xe0, 'Ctrl'],
  0xa3: [0xe4, 'Ctrl'],
  0xa4: [0xe2, 'Alt'],
  0xa5: [0xe6, 'Alt'],
  0xad: [0xe2, 'Mute', 'consumer'],
  0xae: [0xea, 'Vol −', 'consumer'],
  0xaf: [0xe9, 'Vol +', 'consumer'],
  0xb0: [0xb5, 'Next', 'consumer'],
  0xb1: [0xb6, 'Prev', 'consumer'],
  0xb2: [0xb7, 'Stop', 'consumer'],
  0xb3: [0xcd, 'Play', 'consumer'],
  0xba: [0x33, ';'],
  0xbb: [0x2e, '='],
  0xbc: [0x36, ','],
  0xbd: [0x2d, '-'],
  0xbe: [0x37, '.'],
  0xbf: [0x38, '/'],
  0xc0: [0x35, '`'],
  0xdb: [0x2f, '['],
  0xdc: [0x31, '\\'],
  0xdd: [0x30, ']'],
  0xde: [0x34, "'"],
  0xe2: [0x64, '\\'],
  0xfd: [0x58, 'Num Enter'],
};
for (let i = 0; i < 26; i++) VK[0x41 + i] = [0x04 + i, String.fromCharCode(0x41 + i)];
for (let i = 1; i <= 9; i++) VK[0x30 + i] = [0x1d + i, String(i)];
VK[0x30] = [0x27, '0'];
for (let i = 0; i < 12; i++) VK[0x70 + i] = [0x3a + i, `F${i + 1}`];
for (let i = 1; i <= 9; i++) VK[0x60 + i] = [0x58 + i, `Num ${i}`];
const FN_VK = 0xfa;

/** One key of RK's table: rectangle on RK's picture, virtual-key code, table index, key type. */
export type RkKey = [number, number, number, number, number, number, number?];
export interface RkModelKeys {
  rgb: boolean;
  keys: RkKey[];
}

/** The firmware code of a key's factory function. */
export function factoryCode(vk: number): number {
  if (vk === FN_VK) return FN_CODE;
  const e = VK[vk];
  if (!e) throw new ProtocolError(`Unknown key code 0x${vk.toString(16)} in the model table.`);
  if (e[2] === 'consumer') return CONSUMER | e[0];
  const mod = modifierBitForUsage(e[0]);
  return mod !== undefined ? mod << 16 : e[0] << 8;
}

/** The firmware code of an action on the key whose factory code is `factory`. */
export function actionCode(a: KeyAction, factory: number): number {
  switch (a.kind) {
    case 'default':
      return factory;
    case 'keyboard': {
      const mods = a.modifiers & 0xff;
      const mod = modifierBitForUsage(a.usage);
      if (mod !== undefined) return (mods | mod) << 16;
      if (a.usage < 0 || a.usage > 0xff) throw new ProtocolError('Key usage out of range.');
      if (!a.usage && !mods) throw new ProtocolError('A key needs a key or a modifier.');
      return (mods << 16) | (a.usage << 8);
    }
    case 'consumer':
      if (a.usage < 1 || a.usage > 0xffff) throw new ProtocolError('Media usage out of range.');
      return CONSUMER | a.usage;
    default:
      throw new ProtocolError(`Classic RK key maps cannot hold “${a.kind}”.`);
  }
}

/** Splits `data` into `count` reports: header `count n` (+ `first` on report 1), then data. */
function reports(data: Uint8Array, count: number, first: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const r = new Uint8Array(REPORT_BYTES);
    const head = [count, i + 1, ...(i === 0 ? first : [])];
    r.set(head);
    const n = REPORT_BYTES - head.length;
    r.set(data.subarray(at, at + n), head.length);
    at += n;
    out.push(r);
  }
  return out;
}

const KEYMAP_CAPACITY = KEYMAP_REPORTS * REPORT_BYTES - KEYMAP_REPORTS * 2 - 2;
const COLOR_CAPACITY = COLOR_REPORTS * REPORT_BYTES - COLOR_REPORTS * 2 - 3;

/** The 9 key-map reports (without the report ID): every key of the table, `slots` overriding. */
export function keymapReports(model: RkModelKeys, slots: Record<number, KeyAction>): Uint8Array[] {
  const data = new Uint8Array(KEYMAP_CAPACITY);
  for (const [, , , , vk, index] of model.keys) {
    const factory = factoryCode(vk);
    const a = vk === FN_VK ? undefined : slots[index];
    const code = a ? actionCode(a, factory) : factory;
    if (index * 4 + 4 > data.length) throw new ProtocolError(`Key index ${index} out of range.`);
    data.set([code >>> 24, (code >> 16) & 0xff, (code >> 8) & 0xff, code & 0xff], index * 4);
  }
  return reports(data, KEYMAP_REPORTS, [0x01, 0xf8]);
}

/** The 7 colour reports (without the report ID); keys without a colour are off. */
export function colorReports(colors: PerKeyRgb): Uint8Array[] {
  const data = new Uint8Array(COLOR_CAPACITY);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  for (const [k, rgb] of Object.entries(colors)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i * 3 + 3 > data.length)
      throw new ProtocolError(`LED ${k} out of range.`);
    data.set([c(rgb.r), c(rgb.g), c(rgb.b)], i * 3);
  }
  return reports(data, COLOR_REPORTS, [0x03, 0x7e, 0x01]);
}

/** True when every key of the table has a known code (one model has keys of another type). */
export function keymapWritable(model: RkModelKeys): boolean {
  return model.keys.every(
    ([, , , , vk, , type]) => type === undefined && (vk === FN_VK || !!VK[vk]),
  );
}

/** The keyboard drawn from RK's key rectangles, in key units. */
export function rkLayout(id: string, name: string, model: RkModelKeys): KeyboardLayout {
  // One key unit is the most common distance between neighbouring keys of a row (horizontal) and
  // between neighbouring rows (vertical): RK's pictures are not always square.
  const mode = (values: number[], fallback: number) => {
    const n = new Map<number, number>();
    for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? fallback;
  };
  const sorted = [...model.keys].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const xSteps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = [sorted[i - 1]!, sorted[i]!];
    if (Math.abs(a[1] - b[1]) <= 6 && b[0] - a[0] > 20) xSteps.push(Math.round(b[0] - a[0]));
  }
  const unit = mode(xSteps, 48);
  const rowTops = [...new Set(model.keys.map((k) => k[1]))].sort((a, b) => a - b);
  const ySteps: number[] = [];
  for (let i = 1; i < rowTops.length; i++) {
    const d = rowTops[i]! - rowTops[i - 1]!;
    if (d > unit * 0.6) ySteps.push(d);
  }
  const vUnit = mode(ySteps, unit);
  const keyW = mode(
    model.keys.map((k) => k[2] - k[0]).filter((w) => w > unit * 0.4 && w < unit),
    unit * 0.8,
  );
  const keyH = mode(
    model.keys.map((k) => k[3] - k[1]).filter((h) => h > vUnit * 0.4 && h < vUnit),
    vUnit * 0.8,
  );
  const [gap, vGap] = [Math.max(0, unit - keyW), Math.max(0, vUnit - keyH)];
  const minX = Math.min(...model.keys.map((k) => k[0]));
  const minY = Math.min(...model.keys.map((k) => k[1]));
  const q = (v: number) => Math.round(v * 4) / 4;
  const keys: PhysicalKey[] = model.keys.map(([x1, y1, x2, y2, vk, index, type]) => {
    const e = VK[vk];
    const fixed = vk === FN_VK || type !== undefined;
    return {
      id: `k${index}`,
      label: vk === FN_VK ? 'Fn' : (e?.[1] ?? `0x${vk.toString(16)}`),
      slot: fixed ? -1 : index,
      light: model.rgb ? index : null,
      usage: e && e[2] !== 'consumer' ? e[0] : 0,
      x: q((x1 - minX) / unit),
      y: q((y1 - minY) / vUnit),
      w: Math.max(1, q((x2 - x1 + gap) / unit)),
      h: Math.max(1, q((y2 - y1 + vGap) / vUnit)),
    };
  });
  // Rounding to quarter keys can make neighbours touch: trim the left key of a row, or the upper
  // key of two rows, back to its neighbour.
  for (const k of keys)
    for (const o of keys) {
      if (o === k) continue;
      const overlapX = k.x < o.x + o.w - 0.01 && o.x < k.x + k.w - 0.01;
      const overlapY = k.y < o.y + o.h - 0.01 && o.y < k.y + k.h - 0.01;
      if (!overlapX || !overlapY) continue;
      if (Math.abs(k.y - o.y) < 0.5 && k.x < o.x) k.w = Math.max(0.5, o.x - k.x);
      else if (k.y < o.y) k.h = Math.max(0.5, o.y - k.y);
    }
  return {
    id,
    name,
    width: Math.max(...keys.map((k) => k.x + k.w)),
    height: Math.max(...keys.map((k) => k.y + k.h)),
    keys,
    source:
      'RK’s own key table (KB.ini of RK’s Windows software): positions, key codes and table indices',
  };
}
