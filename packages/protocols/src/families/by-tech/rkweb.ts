import { ansiKeys } from '@openkey/devices';
import type { KeyboardLayout, PhysicalKey } from '@openkey/core';
import type { ByTechModel } from './models.js';
import { BY_TECH_LAYOUT } from './page.js';
import { MATRIX_KEYS } from './matrix.js';

/**
 * RK boards driven by RK's own web driver with the BY Tech ("BeiYing") protocol over USB
 * (`pnpm rk-web`): name, effect numbers, and the factory code of every matrix position on the
 * normal, FN1, FN2 and tap layers. Each board's protocol module confirmed the 6 × 21 matrix, the
 * 126-LED colour table and the 519-byte reports OpenKey uses.
 */
export interface RkWebBoard {
  name: string;
  effects: number[];
  /** Normal, FN1, FN2, tap; 126 factory codes each. */
  tables: number[][];
}

/** Loaded only when an RK board connects. */
export async function rkWebBoard(productId: number): Promise<RkWebBoard | null> {
  const mod: { default: unknown } = await import('./rk-web.json', { with: { type: 'json' } });
  return (
    (mod.default as Record<string, RkWebBoard>)[productId.toString(16).padStart(4, '0')] ?? null
  );
}

const SOURCE =
  'RK’s own web driver (drive.rkgaming.com, protocol BeiYing): board entry, factory key tables and effect list; matched by its USB product ID';

/** A model entry for a board known only from RK's web driver (its model code is not published). */
export function rkWebModel(productId: number, board: RkWebBoard): ByTechModel {
  return {
    identity: '',
    brand: 'RK',
    model: board.name.replace(/^RK[ -]?/i, ''),
    layoutId: 'rk-web',
    pageLayout: BY_TECH_LAYOUT,
    matrix: true,
    effects: 'rk-web',
    webEffects: board.effects,
    brightnessMax: 19,
    productIds: [productId],
    source: SOURCE,
  };
}

/** The ANSI key a factory code stands for: its HID usage, a lone modifier, or Fn. */
function usageOf(code: number): number | 'fn' | null {
  const type = code >>> 24;
  const param = (code >>> 16) & 0xff;
  const low = code & 0xffff;
  if (type === 0x0d) return 'fn';
  if (type !== 0) return null;
  if (low === 0 && param && (param & (param - 1)) === 0) return 0xe0 + Math.log2(param);
  return param === 0 && low > 0 && low <= 0xff ? low : null;
}

const MEDIA: Record<number, string> = {
  0xe9: 'Vol +',
  0xea: 'Vol −',
  0xe2: 'Mute',
  0xcd: 'Play',
  0xb5: 'Next',
  0xb6: 'Prev',
  0xb7: 'Stop',
  0x183: 'Media',
  0x18a: 'Mail',
  0x192: 'Calc',
  0x194: 'PC',
  0x223: 'Web',
};
const SPECIAL: Record<number, string> = { 0x0700000d: 'Home', 0x0700000e: 'Mute' };

/** A short label for a key outside the ANSI block, from its factory code. */
function extraLabel(code: number, index: number): string {
  if (code >>> 24 === 0x02) return MEDIA[code & 0xffff] ?? 'Media';
  return SPECIAL[code] ?? `Key ${index}`;
}

/**
 * The board drawn on the standard ANSI geometry (TKL, or full size when its table has a number
 * pad): each key at its usual place, numbered by the matrix position holding its factory code.
 * Keys of the table with no ANSI place (media keys …) follow in a row below.
 */
export function rkWebLayout(id: string, name: string, board: RkWebBoard): KeyboardLayout {
  const base = board.tables[0]!.slice(0, MATRIX_KEYS);
  const full = base.some((c) => c >= 0x53 && c <= 0x63);
  const byUsage = new Map<number | 'fn', number>();
  base.forEach((c, i) => {
    const u = usageOf(c);
    if (u !== null && !byUsage.has(u)) byUsage.set(u, i);
  });
  const keys: PhysicalKey[] = [];
  const used = new Set<number>();
  for (const a of ansiKeys(full ? 'full' : 'tkl', 'fn')) {
    const i = byUsage.get(a.name === 'Fn' ? 'fn' : a.usage);
    if (i === undefined) continue;
    used.add(i);
    keys.push({
      id: a.name,
      label: a.label,
      slot: a.name === 'Fn' ? -1 : i,
      light: i,
      usage: a.usage,
      x: a.x,
      y: a.y,
      w: a.w ?? 1,
      h: a.h ?? 1,
    });
  }
  const bottom = Math.max(...keys.map((k) => k.y + k.h)) + 0.5;
  let x = 0;
  base.forEach((c, i) => {
    if (!c || used.has(i)) return;
    keys.push({
      id: `m${i}`,
      label: extraLabel(c, i),
      slot: i,
      light: i,
      usage: 0,
      x,
      y: bottom,
      w: 1,
      h: 1,
    });
    x += 1;
  });
  return {
    id,
    name,
    width: Math.max(...keys.map((k) => k.x + k.w)),
    height: Math.max(...keys.map((k) => k.y + k.h)),
    keys,
    source:
      'Standard ANSI positions; matrix positions and factory keys from RK’s own web driver. Keys below the board have no standard place (media keys, knob …).',
  };
}

/** Factory codes of a layer (0 normal, 1 FN1, 2 FN2) by matrix position. */
export function rkWebFactory(board: RkWebBoard, layer: number): Map<number, number> {
  const out = new Map<number, number>();
  (board.tables[layer] ?? []).slice(0, MATRIX_KEYS).forEach((c, i) => out.set(i, c >>> 0));
  return out;
}
