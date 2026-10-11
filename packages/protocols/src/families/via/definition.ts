import type { KeyboardLayout, PhysicalKey } from '@openkey/core';

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
}

export class DefinitionError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : typeof v === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(v.trim()) ? Number(v.trim()) : undefined;

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

const key = (r: number, c: number, cols: number, x: number, y: number, w: number, h: number, label = ''): PhysicalKey => ({
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
 * Keyboard Layout Editor rows → keys. Supports the properties VIA definitions use: x, y, w, h,
 * rx/ry (cluster origin), d (decal, skipped). Rotation is ignored: keys are drawn axis-aligned at
 * their cluster position. Layout options (legend 8, "option,choice") keep choice 0.
 */
export function parseKle(rows: unknown, cols: number, name: string): PhysicalKey[] {
  if (!Array.isArray(rows)) throw new DefinitionError('layouts.keymap must be an array of rows.');
  const out: PhysicalKey[] = [];
  const cur = { x: 0, y: 0, w: 1, h: 1, decal: false };
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
        continue;
      }
      if (typeof item !== 'string') continue;
      const legends = item.split('\n');
      const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(legends[0] ?? '');
      const option = /^\s*\d+\s*,\s*(\d+)\s*$/.exec(legends[8] ?? '');
      if (m && !cur.decal && (!option || option[1] === '0')) out.push(key(Number(m[1]), Number(m[2]), cols, cur.x, cur.y, cur.w, cur.h));
      cur.x += cur.w;
      cur.w = 1;
      cur.h = 1;
      cur.decal = false;
    }
    cur.y += 1;
    cur.x = cluster.x;
  }
  void name;
  return out;
}

function parseVia(j: Record<string, unknown>): ViaDefinition {
  const matrix = j.matrix;
  const layouts = j.layouts;
  if (!isObj(matrix) || !isObj(layouts)) throw new DefinitionError('Not a VIA definition: matrix and layouts are required.');
  const rows = num(matrix.rows);
  const cols = num(matrix.cols);
  if (!rows || !cols || rows > 32 || cols > 32) throw new DefinitionError('matrix.rows and matrix.cols must be 1–32.');
  const name = typeof j.name === 'string' ? j.name : 'VIA keyboard';
  const keys = parseKle(layouts.keymap, cols, name).filter((k) => Number(k.id.slice(1).split('c')[0]) < rows && Number(k.id.split('c')[1]) < cols);
  const menus = Array.isArray(j.menus) ? j.menus.filter((m): m is string => typeof m === 'string') : [];
  const lighting = menus.find((m) => m.startsWith('qmk_')) ?? (typeof j.lighting === 'string' ? j.lighting : undefined);
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
  };
}

function parseQmk(j: Record<string, unknown>): ViaDefinition {
  const layouts = j.layouts as Record<string, unknown>;
  const names = Object.keys(layouts);
  const pick = names.find((n) => /^LAYOUT_all$/i.test(n)) ?? names.find((n) => /^LAYOUT$/i.test(n)) ?? names[0];
  const entry = pick ? layouts[pick] : undefined;
  const list = isObj(entry) && Array.isArray(entry.layout) ? entry.layout : null;
  if (!list) throw new DefinitionError('Not a QMK info.json: layouts.*.layout is missing.');
  const items = list.filter(isObj).filter((k) => Array.isArray(k.matrix) && k.matrix.length === 2);
  const ms = isObj(j.matrix_size) ? j.matrix_size : null;
  const rows = num(ms?.rows) ?? Math.max(...items.map((k) => Number((k.matrix as number[])[0]))) + 1;
  const cols = num(ms?.cols) ?? Math.max(...items.map((k) => Number((k.matrix as number[])[1]))) + 1;
  if (!rows || !cols || rows > 32 || cols > 32) throw new DefinitionError('The matrix must be 1–32 rows and columns.');
  const name = typeof j.keyboard_name === 'string' ? j.keyboard_name : 'QMK keyboard';
  const keys = items.map((k) => {
    const [r, c] = k.matrix as [number, number];
    return key(r, c, cols, Number(k.x ?? 0), Number(k.y ?? 0), Number(k.w ?? 1), Number(k.h ?? 1), typeof k.label === 'string' ? k.label : '');
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
  if (isObj(j.layouts)) return parseQmk(j);
  throw new DefinitionError('Not a VIA definition or QMK info.json.');
}

/** A plain rows × columns grid, for boards without a definition: every matrix position is a key. */
export function gridDefinition(rows: number, cols: number, name: string): ViaDefinition {
  const keys: PhysicalKey[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) keys.push(key(r, c, cols, c, r, 1, 1, `${r},${c}`));
  return { name, rows, cols, layout: finish(`grid-${rows}x${cols}`, `${name} (matrix ${rows}×${cols})`, keys, 'matrix grid (no definition loaded)'), format: 'grid' };
}

/** Serialized form kept in the state store (the parsed result, not the user's file). */
export type StoredDefinition = ViaDefinition;
