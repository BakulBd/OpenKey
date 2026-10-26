import { modifierBitForUsage } from '@openkey/core';
import type { KeyboardLayout } from '@openkey/core';
import { FN_VK, rkLayout, vkUsage } from '../rk-classic/keytable.js';
import type { RkKey } from '../rk-classic/keytable.js';

/**
 * RK's own key table for a BY Tech board (KB.ini of RK's Windows software, built by `pnpm rk-keys`):
 * key rectangles, Windows key codes and matrix indices, base-layer keys given as BY Tech codes, and
 * the factory functions of the FN1 and FN2 layers (`[index, 9, BY Tech code]` or `[index, 2, VK]`).
 */
export interface RkByTechKeys {
  rgb: boolean;
  keys: RkKey[];
  direct: [number, number][];
  fn1: [number, number, number][];
  fn2: [number, number, number][];
}

/** Loaded only when such a board connects. */
export async function rkByTechKeys(folder: string): Promise<RkByTechKeys | null> {
  const mod: { default: unknown } = await import('./rk-keys.json', { with: { type: 'json' } });
  return (mod.default as Record<string, RkByTechKeys>)[folder] ?? null;
}

const FN_CODE = 0x0d000000;

/** The BY Tech code of a Windows key code: keyboard usage, modifier mask, or media key. */
export function vkCode(vk: number): number | undefined {
  if (vk === FN_VK) return FN_CODE;
  const u = vkUsage(vk);
  if (!u) return undefined;
  if (u.consumer) return (0x02000000 | u.usage) >>> 0;
  const bit = modifierBitForUsage(u.usage);
  return bit !== undefined ? (bit << 16) >>> 0 : u.usage;
}

/** Factory codes of a layer (0 base, 1 FN1, 2 FN2) by matrix index, as RK's table lists them. */
export function rkFactory(keys: RkByTechKeys, layer: number): Map<number, number> {
  const out = new Map<number, number>();
  if (layer === 0) {
    for (const [, , , , vk, index] of keys.keys) {
      const c = vkCode(vk);
      if (c !== undefined) out.set(index, c);
    }
    for (const [index, code] of keys.direct) out.set(index, code >>> 0);
    return out;
  }
  for (const [index, type, value] of layer === 1 ? keys.fn1 : keys.fn2) {
    const c = type === 9 ? value >>> 0 : vkCode(value);
    if (c !== undefined) out.set(index, c);
  }
  return out;
}

/** The keyboard drawn from RK's key rectangles (keys and LEDs numbered by the matrix). */
export function rkByTechLayout(id: string, name: string, keys: RkByTechKeys): KeyboardLayout {
  return rkLayout(id, name, { rgb: keys.rgb, keys: keys.keys });
}
