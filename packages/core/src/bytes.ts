/** Byte helpers shared by transports, protocols, fixtures and tools. */

export function toHex(bytes: ArrayLike<number>, separator = ' '): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0) out += separator;
    out += (bytes[i]! & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

/** Compact hex dump that collapses long runs of a repeated byte, e.g. `04 18 00×62`. */
export function toHexCompact(bytes: ArrayLike<number>, minRun = 6): string {
  const parts: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]! & 0xff;
    let j = i + 1;
    while (j < bytes.length && (bytes[j]! & 0xff) === b) j++;
    const run = j - i;
    const h = b.toString(16).padStart(2, '0');
    if (run >= minRun) {
      parts.push(`${h}×${run}`);
    } else {
      for (let k = 0; k < run; k++) parts.push(h);
    }
    i = j;
  }
  return parts.join(' ');
}

export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2 !== 0) throw new Error(`Odd-length hex string: ${text}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function hex16(n: number): string {
  return `0x${(n & 0xffff).toString(16).padStart(4, '0').toUpperCase()}`;
}

export function hex8(n: number): string {
  return `0x${(n & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
}

export function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function concatBytes(...chunks: ArrayLike<number>[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export function u16le(bytes: ArrayLike<number>, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)) & 0xffff;
}

export function writeU16le(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
}

export function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}

/** Returns a copy padded (or truncated) to `length`, using `fill` for the padding. */
export function padTo(bytes: ArrayLike<number>, length: number, fill = 0): Uint8Array {
  const out = new Uint8Array(length).fill(fill);
  out.set(Array.from(bytes).slice(0, length));
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
