/** One changed leaf between two JSON-like values. `path` uses dot/bracket notation. */
export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}

function join(base: string, key: string | number): string {
  return typeof key === 'number' ? `${base}[${key}]` : base ? `${base}.${key}` : key;
}

/**
 * Structural diff of plain data (objects, arrays, primitives, Uint8Array). Used for staged changes,
 * backup restore previews and read-back verification, so it never depends on key order.
 */
export function diffValues(before: unknown, after: unknown, path = ''): Change[] {
  if (Object.is(before, after)) return [];
  if (before instanceof Uint8Array && after instanceof Uint8Array) {
    if (before.length === after.length && before.every((b, i) => b === after[i])) return [];
    return [{ path, before, after }];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: Change[] = [];
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) out.push(...diffValues(before[i], after[i], join(path, i)));
    return out;
  }
  if (isObject(before) && isObject(after)) {
    const out: Change[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of [...keys].sort()) out.push(...diffValues(before[k], after[k], join(path, k)));
    return out;
  }
  return [{ path, before, after }];
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return diffValues(a, b).length === 0;
}

/** Short human rendering of a value for diff tables. */
export function formatDiffValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v instanceof Uint8Array) return `${v.length} bytes`;
  if (typeof v === 'object') return JSON.stringify(v as Json);
  return String(v);
}
