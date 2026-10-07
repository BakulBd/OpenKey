import type { PerKeyRgb } from '@openkey/core';

/**
 * Per-key colour tables are arrays of 4-byte entries [index, R, G, B] in both families
 * (Windows FUN_0044ba10 / FUN_0042aee0: 144 entries; online jd/Ln: 128 entries).
 * Hardware read-back on the AK820 MAX shows byte 0 of entry n is always n.
 */
export function encodePerKeyEntries(
  colors: PerKeyRgb,
  entries: number,
  fillIndices = false,
): Uint8Array {
  const buf = new Uint8Array(entries * 4);
  if (fillIndices) for (let n = 0; n < entries; n++) buf[n * 4] = n;
  for (const [idx, c] of Object.entries(colors)) {
    const n = Number(idx);
    if (!Number.isInteger(n) || n < 0 || n >= entries) continue;
    buf.set([n, c.r & 0xff, c.g & 0xff, c.b & 0xff], n * 4);
  }
  return buf;
}

export function decodePerKeyEntries(buf: Uint8Array, indices: Iterable<number>): PerKeyRgb {
  const out: PerKeyRgb = {};
  for (const n of indices) {
    if (n * 4 + 3 >= buf.length) continue;
    out[n] = { r: buf[n * 4 + 1]!, g: buf[n * 4 + 2]!, b: buf[n * 4 + 3]! };
  }
  return out;
}

/** Structural signature: entry n starts with n (or 0 for never-written entries). */
export function perKeyEntriesValid(
  buf: Uint8Array,
  indices: number[],
): { ok: boolean; matched: number; checked: number } {
  let matched = 0;
  for (const n of indices) {
    const b0 = buf[n * 4];
    if (b0 === n || b0 === 0) matched++;
  }
  return { ok: indices.length > 0 && matched === indices.length, matched, checked: indices.length };
}
