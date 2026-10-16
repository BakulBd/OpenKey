import { ProtocolError } from '@openkey/core';
import type { KeyboardLayout, PhysicalKey } from '@openkey/core';

/** The keyboard description libhmk stores in firmware (scripts/metadata.py; GPL-3.0, facts only). */
export interface HmkMetadata {
  name: string;
  vendorId: number;
  productId: number;
  numProfiles: number;
  numLayers: number;
  numKeys: number;
  layout: KeyboardLayout;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Parses the metadata JSON. Layout keys are placed as in KLE: x and y add to the running position
 * before the key, the key's width advances x, and every row moves down one unit. Keys of a
 * non-default layout option are left out (the default layout is drawn).
 */
export function parseHmkMetadata(json: string): HmkMetadata {
  let j: unknown;
  try {
    j = JSON.parse(json);
  } catch {
    throw new ProtocolError('The keyboard metadata is not valid JSON.');
  }
  if (!isObj(j) || !isObj(j.layout) || !Array.isArray(j.layout.keymap))
    throw new ProtocolError('The keyboard metadata has no layout.');
  const numKeys = n(j.numKeys, 0);
  if (numKeys < 1 || numKeys > 256) throw new ProtocolError('The keyboard reports no keys.');
  const keys: PhysicalKey[] = [];
  let y = 0;
  for (const row of j.layout.keymap) {
    if (!Array.isArray(row)) continue;
    let x = 0;
    for (const k of row) {
      if (!isObj(k)) continue;
      const w = n(k.w, 1);
      const h = n(k.h, 1);
      x += n(k.x, 0);
      y += n(k.y, 0);
      const option = Array.isArray(k.option) ? k.option : null;
      const index = n(k.key, -1);
      if (index >= 0 && index < numKeys && (!option || option[1] === 0))
        keys.push({ id: `k${index}`, label: '', slot: index, light: null, usage: 0, x, y, w, h });
      x += w;
    }
    y += 1;
  }
  const name = typeof j.name === 'string' ? j.name : 'libhmk keyboard';
  return {
    name,
    vendorId: n(j.vendorId, 0),
    productId: n(j.productId, 0),
    numProfiles: Math.max(1, n(j.numProfiles, 1)),
    numLayers: Math.max(1, n(j.numLayers, 1)),
    numKeys,
    layout: {
      id: `hmk-${name}`,
      name,
      width: Math.max(1, ...keys.map((k) => k.x + k.w)),
      height: Math.max(1, ...keys.map((k) => k.y + k.h)),
      keys,
      source: 'libhmk keyboard metadata (from the keyboard)',
    },
  };
}
