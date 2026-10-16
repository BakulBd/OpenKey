import type { KeyboardLayout, PhysicalKey } from '@openkey/core';
import { parseMenus } from './menus.js';
import type { CustomMenu } from './menus.js';

/**
 * Keyboard definitions for VIA boards. The VIA protocol does not report the key matrix or the
 * physical layout, so they come from a definition file the user loads: a VIA definition (`layouts.keymap`
 * in Keyboard Layout Editor format, matrix position "row,col" as the top-left legend; see the VIA
 * specification) or a QMK `info.json` / `keyboard.json` (`layouts.*.layout[].matrix`). Files are parsed
 * as data only; nothing in them is executed.
 */
export interface ViaDefinition {
  name: string;
  vendorId?: number;
  productId?: number;
  rows: number;
  cols: number;
  layout: KeyboardLayout;
  /** Lighting menu the definition declares ("qmk_rgb_matrix", "qmk_rgblight", "qmk_backlight" …). */
  lighting?: string;
  format: 'via' | 'qmk' | 'grid';
  /** Layout options the definition declares (ISO Enter, split Backspace …), when any. */
  options?: LayoutOption[];
  /** The chosen choice per option (0 = the definition's default). */
  choices?: number[];
  /** Keys by option group, kept so another choice can be applied without the file. */
  parts?: LayoutParts;
  /** Number of rotary encoders the layout shows (VIA encoder index + 1). */
  encoders?: number;
  /** VIA v3 custom menus the definition declares (built-in menu names excluded). */
  menus?: CustomMenu[];
  /** Read from the keyboard's Vial firmware: Vial features may be used on later connections too. */
  vial?: boolean;
}

/**
 * Encoder slots follow the matrix: slot rows × cols + 2 × index (+1 for clockwise). The layout draws a
 * knob as ↺ / ↻ halves (or ↺ / press / ↻ thirds when it is also a matrix key).
 */
export function encoderSlot(rows: number, cols: number, index: number, clockwise: boolean): number {
  return rows * cols + index * 2 + (clockwise ? 1 : 0);
}

export function encoderOfSlot(
  rows: number,
  cols: number,
  slot: number,
): { index: number; clockwise: boolean } | null {
  const n = slot - rows * cols;
  return n >= 0 ? { index: n >> 1, clockwise: (n & 1) === 1 } : null;
}

/** The keys of one knob at a key position. */
function knob(
  index: number,
  rows: number,
  cols: number,
  x: number,
  y: number,
  w: number,
  h: number,
  press: { row: number; col: number } | null,
): PhysicalKey[] {
  const part = press ? w / 3 : w / 2;
  const turn = (clockwise: boolean, at: number): PhysicalKey => ({
    id: `e${index}${clockwise ? 'cw' : 'ccw'}`,
    label: clockwise ? '↻' : '↺',
    slot: encoderSlot(rows, cols, index, clockwise),
    light: null,
    usage: 0,
    x: at,
    y,
    w: part,
    h,
  });
  return [
    turn(false, x),
    ...(press ? [key(press.row, press.col, cols, x + part, y, part, h, '●')] : []),
    turn(true, x + w - part),
  ];
}

/** One VIA layout option: a toggle (choices Off/On) or a named list of choices. */
export interface LayoutOption {
  label: string;
  choices: string[];
}

/**
 * The keys of a definition split by layout option, in definition units: `common` keys are always
 * present; `groups["o,c"]` are the keys of choice c of option o.
 */
export interface LayoutParts {
  common: PhysicalKey[];
  groups: Record<string, PhysicalKey[]>;
}

export class DefinitionError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number'
    ? v
    : typeof v === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(v.trim())
      ? Number(v.trim())
      : undefined;

/** Finished key list → layout; positions are shifted so the top-left key is at 0,0. */
function finish(id: string, name: string, keys: PhysicalKey[], source: string): KeyboardLayout {
  if (keys.length === 0) throw new DefinitionError('The definition has no keys.');
  const minX = Math.min(...keys.map((k) => k.x));
  const minY = Math.min(...keys.map((k) => k.y));
  for (const k of keys) {
    k.x -= minX;
    k.y -= minY;
  }
  return {
    id,
    name,
    width: Math.max(...keys.map((k) => k.x + k.w)),
    height: Math.max(...keys.map((k) => k.y + k.h)),
    keys,
    source,
  };
}

const key = (
  r: number,
  c: number,
  cols: number,
  x: number,
  y: number,
  w: number,
  h: number,
  label = '',
): PhysicalKey => ({
  id: `r${r}c${c}`,
  label,
  slot: r * cols + c,
  light: null,
  usage: 0,
  x,
  y,
  w,
  h,
});

/**
 * Where each legend of a KLE label string lands, per text alignment `a` (kle-serial, MIT). VIA reads
 * labels this way with `a` = 0 unless the file sets it: the matrix position is canonical legend 0, the
 * layout option ("option,choice") legend 8 and the encoder ("e0") legend 4.
 */
const ALIGNMENT = [
  [0, 6, 2, 8, 9, 11, 3, 5, 1, 4, 7, 10],
  [1, 7, -1, -1, 9, 11, 4, -1, -1, -1, -1, 10],
  [3, -1, 5, -1, 9, 11, -1, -1, 4, -1, -1, 10],
  [4, -1, -1, -1, 9, 11, -1, -1, -1, -1, -1, 10],
  [0, 6, 2, 8, 10, -1, 3, 5, 1, 4, 7, -1],
  [1, 7, -1, -1, 10, -1, 4, -1, -1, -1, -1, -1],
  [3, -1, 5, -1, 10, -1, -1, -1, 4, -1, -1, -1],
  [4, -1, -1, -1, 10, -1, -1, -1, -1, -1, -1, -1],
];
const LEGEND = { ROWCOL: 0, ENCODER: 4, GROUP: 8 } as const;

function legends(label: string, a: number): string[] {
  const map = ALIGNMENT[a] ?? ALIGNMENT[0]!;
  const out: string[] = [];
  label.split('\n').forEach((text, i) => {
    const at = map[i];
    if (at !== undefined && at >= 0) out[at] = text.trim();
  });
  return out;
}

const PAIR = /^\s*(\d+)\s*,\s*(\d+)\s*$/;

/**
 * Keyboard Layout Editor rows → keys, split by layout option. Supports the properties VIA
 * definitions use: x, y, w, h, rx/ry (cluster origin), d (decal, skipped), a (legend alignment).
 * Rotation is ignored: keys are drawn axis-aligned at their cluster position.
 */
export function parseKleParts(rows: unknown, cols: number, matrixRows = 32): LayoutParts {
  if (!Array.isArray(rows)) throw new DefinitionError('layouts.keymap must be an array of rows.');
  const parts: LayoutParts = { common: [], groups: {} };
  const cur = { x: 0, y: 0, w: 1, h: 1, decal: false, a: 0 };
  const cluster = { x: 0, y: 0 };
  for (const row of rows) {
    if (!Array.isArray(row)) continue; // metadata object at the top of KLE files
    for (const item of row) {
      if (isObj(item)) {
        if (typeof item.rx === 'number') {
          cluster.x = item.rx;
          cur.x = cluster.x;
          cur.y = cluster.y;
        }
        if (typeof item.ry === 'number') {
          cluster.y = item.ry;
          cur.x = cluster.x;
          cur.y = cluster.y;
        }
        if (typeof item.x === 'number') cur.x += item.x;
        if (typeof item.y === 'number') cur.y += item.y;
        if (typeof item.w === 'number') cur.w = item.w;
        if (typeof item.h === 'number') cur.h = item.h;
        if (typeof item.d === 'boolean') cur.decal = item.d;
        if (typeof item.a === 'number') cur.a = item.a;
        continue;
      }
      if (typeof item !== 'string') continue;
      const l = legends(item, cur.a);
      const m = PAIR.exec(l[LEGEND.ROWCOL] ?? '');
      const option = PAIR.exec(l[LEGEND.GROUP] ?? '');
      const enc = /^[eE](\d+)$/.exec(l[LEGEND.ENCODER] ?? '');
      if (!cur.decal && (m || enc)) {
        const ks = enc
          ? knob(
              Number(enc[1]),
              matrixRows,
              cols,
              cur.x,
              cur.y,
              cur.w,
              cur.h,
              m ? { row: Number(m[1]), col: Number(m[2]) } : null,
            )
          : [key(Number(m![1]), Number(m![2]), cols, cur.x, cur.y, cur.w, cur.h)];
        if (option) (parts.groups[`${option[1]},${option[2]}`] ??= []).push(...ks);
        else parts.common.push(...ks);
      }
      cur.x += cur.w;
      cur.w = 1;
      cur.h = 1;
      cur.decal = false;
    }
    cur.y += 1;
    cur.x = cluster.x;
  }
  return parts;
}

/** Keyboard Layout Editor rows → the keys of the default layout (choice 0 of every option). */
export function parseKle(rows: unknown, cols: number, name: string): PhysicalKey[] {
  void name;
  return selectKeys(parseKleParts(rows, cols), []);
}

const bounds = (keys: PhysicalKey[]) => ({
  x: Math.min(...keys.map((k) => k.x)),
  y: Math.min(...keys.map((k) => k.y)),
});

/**
 * The keys of one combination of choices. As in VIA, the keys of a non-default choice are moved so
 * that their top-left corner meets the default choice's, wherever the definition drew them.
 */
function selectKeys(parts: LayoutParts, choices: readonly number[]): PhysicalKey[] {
  const out = parts.common.map((k) => ({ ...k }));
  const options = new Set(Object.keys(parts.groups).map((g) => Number(g.split(',')[0])));
  for (const o of [...options].sort((a, b) => a - b)) {
    const c = choices[o] ?? 0;
    const group = parts.groups[`${o},${c}`] ?? [];
    const base = parts.groups[`${o},0`];
    let dx = 0;
    let dy = 0;
    if (c !== 0 && base?.length && group.length) {
      const a = bounds(base);
      const b = bounds(group);
      dx = a.x - b.x;
      dy = a.y - b.y;
    }
    for (const k of group) out.push({ ...k, x: k.x + dx, y: k.y + dy });
  }
  return out;
}

/** `layouts.labels`: a string is an Off/On toggle; an array is [label, choice 0, choice 1, …]. */
function parseLabels(v: unknown): LayoutOption[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((l): LayoutOption[] =>
    typeof l === 'string'
      ? [{ label: l, choices: ['Off', 'On'] }]
      : Array.isArray(l) && typeof l[0] === 'string'
        ? [{ label: l[0], choices: l.slice(1).map(String) }]
        : [],
  );
}

const inMatrix = (rows: number, cols: number) => (k: PhysicalKey) =>
  !/^r\d+c\d+$/.test(k.id) ||
  (Number(k.id.slice(1).split('c')[0]) < rows && Number(k.id.split('c')[1]) < cols);

function filterParts(parts: LayoutParts, keep: (k: PhysicalKey) => boolean): LayoutParts {
  return {
    common: parts.common.filter(keep),
    groups: Object.fromEntries(Object.entries(parts.groups).map(([g, ks]) => [g, ks.filter(keep)])),
  };
}

/** Bits VIA gives one option: enough for its choices (a toggle takes one). */
const optionBits = (choices: number) => {
  let bits = 1;
  while (1 << bits < choices) bits++;
  return bits;
};

/**
 * VIA keeps the chosen layout options in one 32-bit keyboard value: the first option in the highest
 * bits, the last in the lowest (the-via/app bit-pack.ts).
 */
export function unpackLayoutOptions(value: number, options: readonly LayoutOption[]): number[] {
  const out: number[] = [];
  let bits = value >>> 0;
  for (let i = options.length - 1; i >= 0; i--) {
    const n = optionBits(Math.max(2, options[i]!.choices.length));
    out[i] = bits & ((1 << n) - 1);
    bits >>>= n;
  }
  return out.map((c, i) => (c < options[i]!.choices.length ? c : 0));
}

export function packLayoutOptions(
  choices: readonly number[],
  options: readonly LayoutOption[],
): number {
  return (
    options.reduce(
      (acc, o, i) => (acc << optionBits(Math.max(2, o.choices.length))) | (choices[i] ?? 0),
      0,
    ) >>> 0
  );
}

/** Applies a combination of layout options; returns the definition with the new layout. */
export function withLayoutOptions(def: ViaDefinition, choices: readonly number[]): ViaDefinition {
  if (!def.parts) return def;
  return {
    ...def,
    choices: [...choices],
    layout: finish(
      def.layout.id,
      def.layout.name,
      selectKeys(def.parts, choices),
      def.layout.source,
    ),
  };
}

function parseVia(j: Record<string, unknown>): ViaDefinition {
  const matrix = j.matrix;
  const layouts = j.layouts;
  if (!isObj(matrix) || !isObj(layouts))
    throw new DefinitionError('Not a VIA definition: matrix and layouts are required.');
  const rows = num(matrix.rows);
  const cols = num(matrix.cols);
  if (!rows || !cols || rows > 32 || cols > 32)
    throw new DefinitionError('matrix.rows and matrix.cols must be 1–32.');
  const name = typeof j.name === 'string' ? j.name : 'VIA keyboard';
  const parts = filterParts(parseKleParts(layouts.keymap, cols, rows), inMatrix(rows, cols));
  const encoders =
    1 +
    Math.max(
      -1,
      ...[...parts.common, ...Object.values(parts.groups).flat()]
        .map((k) => /^e(\d+)c/.exec(k.id))
        .filter((x): x is RegExpExecArray => !!x)
        .map((x) => Number(x[1])),
    );
  const options = parseLabels(layouts.labels);
  const keys = selectKeys(parts, []);
  const menus = Array.isArray(j.menus)
    ? j.menus.filter((m): m is string => typeof m === 'string')
    : [];
  const lighting =
    menus.find((m) => m.startsWith('qmk_')) ??
    (typeof j.lighting === 'string' ? j.lighting : undefined);
  const vendorId = num(j.vendorId);
  const productId = num(j.productId);
  return {
    name,
    ...(vendorId !== undefined ? { vendorId } : {}),
    ...(productId !== undefined ? { productId } : {}),
    rows,
    cols,
    layout: finish(`via-${name}`, name, keys, 'VIA definition (loaded by you)'),
    ...(lighting ? { lighting } : {}),
    format: 'via',
    ...(Object.keys(parts.groups).length ? { options, choices: [], parts } : {}),
    ...(encoders ? { encoders } : {}),
    ...withMenus(j.menus),
  };
}

function parseQmk(j: Record<string, unknown>): ViaDefinition {
  const layouts = j.layouts as Record<string, unknown>;
  const names = Object.keys(layouts);
  const pick =
    names.find((n) => /^LAYOUT_all$/i.test(n)) ??
    names.find((n) => /^LAYOUT$/i.test(n)) ??
    names[0];
  const entry = pick ? layouts[pick] : undefined;
  const list = isObj(entry) && Array.isArray(entry.layout) ? entry.layout : null;
  if (!list) throw new DefinitionError('Not a QMK info.json: layouts.*.layout is missing.');
  const items = list.filter(isObj).filter((k) => Array.isArray(k.matrix) && k.matrix.length === 2);
  const ms = isObj(j.matrix_size) ? j.matrix_size : null;
  const rows =
    num(ms?.rows) ?? Math.max(...items.map((k) => Number((k.matrix as number[])[0]))) + 1;
  const cols =
    num(ms?.cols) ?? Math.max(...items.map((k) => Number((k.matrix as number[])[1]))) + 1;
  if (!rows || !cols || rows > 32 || cols > 32)
    throw new DefinitionError('The matrix must be 1–32 rows and columns.');
  const name = typeof j.keyboard_name === 'string' ? j.keyboard_name : 'QMK keyboard';
  const keys = items.map((k) => {
    const [r, c] = k.matrix as [number, number];
    return key(
      r,
      c,
      cols,
      Number(k.x ?? 0),
      Number(k.y ?? 0),
      Number(k.w ?? 1),
      Number(k.h ?? 1),
      typeof k.label === 'string' ? k.label : '',
    );
  });
  const usb = isObj(j.usb) ? j.usb : {};
  const vendorId = num(usb.vid);
  const productId = num(usb.pid);
  return {
    name,
    ...(vendorId !== undefined ? { vendorId } : {}),
    ...(productId !== undefined ? { productId } : {}),
    rows,
    cols,
    layout: finish(`qmk-${name}`, `${name} (${pick})`, keys, 'QMK info.json (loaded by you)'),
    format: 'qmk',
  };
}

/**
 * VIA's compiled definitions (as served by usevia.app/definitions/v2|v3/<id>.json): the KLE layout is
 * already resolved into `layouts.keys[]` with `row`, `col`, `x`, `y`, `w`, `h` and `d` (decal).
 * Layout options live in `optionKeys`; the default keys are in `keys`.
 */
function parseCompiled(j: Record<string, unknown>): ViaDefinition {
  const layouts = j.layouts as Record<string, unknown>;
  const items = (layouts.keys as unknown[])
    .filter(isObj)
    .filter(
      (k) =>
        k.d !== true &&
        ((typeof k.row === 'number' && typeof k.col === 'number') || typeof k.ei === 'number'),
    );
  if (!items.length) throw new DefinitionError('The definition has no keys.');
  const matrix = isObj(j.matrix) ? j.matrix : null;
  const rows = num(matrix?.rows) ?? Math.max(...items.map((k) => Number(k.row ?? 0))) + 1;
  const cols = num(matrix?.cols) ?? Math.max(...items.map((k) => Number(k.col ?? 0))) + 1;
  if (!(rows >= 1 && rows <= 32 && cols >= 1 && cols <= 32))
    throw new DefinitionError('matrix.rows and matrix.cols must be 1–32.');
  const name = typeof j.name === 'string' ? j.name : 'VIA keyboard';
  const toKey = (k: Record<string, unknown>) =>
    key(
      Number(k.row),
      Number(k.col),
      cols,
      Number(k.x ?? 0),
      Number(k.y ?? 0),
      Number(k.w ?? 1),
      Number(k.h ?? 1),
    );
  const inRange = (k: Record<string, unknown>) =>
    typeof k.row === 'number' &&
    typeof k.col === 'number' &&
    k.row >= 0 &&
    k.col >= 0 &&
    k.row < rows &&
    k.col < cols;
  const usable = (k: Record<string, unknown>) =>
    k.d !== true && (inRange(k) || typeof k.ei === 'number');
  let encoders = 0;
  const toKeys = (k: Record<string, unknown>): PhysicalKey[] => {
    if (typeof k.ei !== 'number') return [toKey(k)];
    encoders = Math.max(encoders, k.ei + 1);
    return knob(
      k.ei,
      rows,
      cols,
      Number(k.x ?? 0),
      Number(k.y ?? 0),
      Number(k.w ?? 1),
      Number(k.h ?? 1),
      inRange(k) ? { row: Number(k.row), col: Number(k.col) } : null,
    );
  };
  // Option keys are not in `keys`: they live in optionKeys[option][choice].
  const groups: Record<string, PhysicalKey[]> = {};
  if (isObj(layouts.optionKeys))
    for (const [o, byChoice] of Object.entries(layouts.optionKeys))
      if (isObj(byChoice))
        for (const [c, list] of Object.entries(byChoice))
          if (Array.isArray(list))
            groups[`${o},${c}`] = list.filter(isObj).filter(usable).flatMap(toKeys);
  const parts: LayoutParts = { common: items.filter(usable).flatMap(toKeys), groups };
  const options = parseLabels(layouts.labels);
  const keys = selectKeys(parts, []);
  const menus = Array.isArray(j.menus)
    ? j.menus.filter((m): m is string => typeof m === 'string')
    : [];
  const lighting =
    menus.find((m) => m.startsWith('qmk_')) ??
    (typeof j.lighting === 'string' ? j.lighting : undefined);
  const vpid = num(j.vendorProductId);
  return {
    name,
    ...(vpid !== undefined ? { vendorId: vpid >>> 16, productId: vpid & 0xffff } : {}),
    rows,
    cols,
    layout: finish(`via-${name}`, name, keys, 'VIA definition'),
    ...(lighting ? { lighting } : {}),
    format: 'via',
    ...(Object.keys(groups).length ? { options, choices: [], parts } : {}),
    ...(encoders ? { encoders } : {}),
    ...withMenus(j.menus),
  };
}

function withMenus(menus: unknown): { menus?: CustomMenu[] } {
  const m = parseMenus(menus).filter((x) => x.sections.some((s) => s.controls.length));
  return m.length ? { menus: m } : {};
}

/** Where VIA publishes the compiled definition for a USB identity (v3 first, then v2). */
export function viaDefinitionUrls(vendorId: number, productId: number): string[] {
  const id = ((vendorId << 16) | productId) >>> 0;
  return [
    `https://usevia.app/definitions/v3/${id}.json`,
    `https://usevia.app/definitions/v2/${id}.json`,
  ];
}

/** Parses a VIA definition or a QMK info.json/keyboard.json. Throws DefinitionError with a reason. */
export function parseDefinition(text: string): ViaDefinition {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new DefinitionError('The file is not valid JSON.');
  }
  if (!isObj(j)) throw new DefinitionError('The file is not a keyboard definition.');
  if (isObj(j.matrix) && isObj(j.layouts) && 'keymap' in j.layouts) return parseVia(j);
  if (isObj(j.layouts) && Array.isArray(j.layouts.keys)) return parseCompiled(j);
  if (isObj(j.layouts)) return parseQmk(j);
  throw new DefinitionError('Not a VIA definition or QMK info.json.');
}

/** A plain rows × columns grid, for boards without a definition: every matrix position is a key. */
export function gridDefinition(rows: number, cols: number, name: string): ViaDefinition {
  const keys: PhysicalKey[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) keys.push(key(r, c, cols, c, r, 1, 1, `${r},${c}`));
  return {
    name,
    rows,
    cols,
    layout: finish(
      `grid-${rows}x${cols}`,
      `${name} (matrix ${rows}×${cols})`,
      keys,
      'matrix grid (no definition loaded)',
    ),
    format: 'grid',
  };
}

/** Serialized form kept in the state store (the parsed result, not the user's file). */
export type StoredDefinition = ViaDefinition;
