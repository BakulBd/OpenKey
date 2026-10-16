/**
 * The protobuf wire format, as far as ZMK Studio's messages need it: varints, zig-zag sint32,
 * length-delimited fields and nested messages. Hand-written so the browser bundle needs no protobuf
 * runtime; messages are built and read field by field in messages.ts.
 *
 * Serial framing (zmk-studio-ts-client framing.ts, MIT): every message is wrapped in SOF 0xAB … EOF
 * 0xAD; SOF, ESC (0xAC) and EOF inside the payload are preceded by ESC.
 */

export class WireError extends Error {}

export const SOF = 0xab;
export const ESC = 0xac;
export const EOF = 0xad;

export function frame(payload: Uint8Array): Uint8Array {
  const out: number[] = [SOF];
  for (const b of payload) {
    if (b === SOF || b === ESC || b === EOF) out.push(ESC);
    out.push(b);
  }
  out.push(EOF);
  return Uint8Array.from(out);
}

/** Incremental deframer: feed bytes as they arrive, get whole payloads back. */
export class Deframer {
  private state: 'idle' | 'data' | 'escaped' = 'idle';
  private buf: number[] = [];
  push(bytes: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const b of bytes) {
      if (this.state === 'idle') {
        if (b === SOF) {
          this.state = 'data';
          this.buf = [];
        }
        // Bytes outside a frame (boot noise) are ignored.
      } else if (this.state === 'escaped') {
        this.buf.push(b);
        this.state = 'data';
      } else if (b === ESC) this.state = 'escaped';
      else if (b === EOF) {
        out.push(Uint8Array.from(this.buf));
        this.state = 'idle';
      } else if (b === SOF) this.buf = [];
      else this.buf.push(b);
    }
    return out;
  }
}

// ---------------------------------------------------------------- writer

export class Writer {
  private out: number[] = [];
  private varint(v: number): void {
    let n = v >>> 0;
    while (n > 0x7f) {
      this.out.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.out.push(n);
  }
  private tag(field: number, wire: number): void {
    this.varint((field << 3) | wire);
  }
  uint32(field: number, v: number): this {
    this.tag(field, 0);
    this.varint(v);
    return this;
  }
  /** int32 written as protobuf does: negative values as ten-byte two's complement. */
  int32(field: number, v: number): this {
    if (v >= 0) return this.uint32(field, v);
    this.tag(field, 0);
    let lo = v >>> 0;
    for (let i = 0; i < 4; i++) {
      this.out.push((lo & 0x7f) | 0x80);
      lo >>>= 7;
    }
    this.out.push((lo & 0x0f) | 0x70 | 0x80);
    for (let i = 0; i < 4; i++) this.out.push(0xff);
    this.out.push(0x01);
    return this;
  }
  sint32(field: number, v: number): this {
    return this.uint32(field, ((v << 1) ^ (v >> 31)) >>> 0);
  }
  bool(field: number, v: boolean): this {
    return this.uint32(field, v ? 1 : 0);
  }
  bytes(field: number, b: Uint8Array): this {
    this.tag(field, 2);
    this.varint(b.length);
    for (const x of b) this.out.push(x);
    return this;
  }
  string(field: number, s: string): this {
    return this.bytes(field, new TextEncoder().encode(s));
  }
  message(field: number, w: Writer): this {
    return this.bytes(field, w.finish());
  }
  finish(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

// ---------------------------------------------------------------- reader

export interface Field {
  field: number;
  wire: number;
  /** Varint value (wire 0), or the length-delimited bytes (wire 2). */
  value: number;
  bytes: Uint8Array;
}

/** Splits a message into its fields. Unknown wire types (64/32-bit) are skipped by size. */
export function fields(b: Uint8Array): Field[] {
  const out: Field[] = [];
  let p = 0;
  const varint = (): number => {
    let v = 0;
    let shift = 0;
    for (;;) {
      if (p >= b.length) throw new WireError('Truncated varint');
      const x = b[p++]!;
      if (shift < 28) v |= (x & 0x7f) << shift;
      else if (shift < 32) v |= (x & 0x0f) << shift; // the low 32 bits are all a uint32/int32 keeps
      shift += 7;
      if (!(x & 0x80)) return v >>> 0;
      if (shift > 63) throw new WireError('Varint too long');
    }
  };
  while (p < b.length) {
    const key = varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) out.push({ field, wire, value: varint(), bytes: new Uint8Array() });
    else if (wire === 2) {
      const n = varint();
      if (p + n > b.length) throw new WireError('Truncated field');
      out.push({ field, wire, value: n, bytes: b.subarray(p, p + n) });
      p += n;
    } else if (wire === 1) p += 8;
    else if (wire === 5) p += 4;
    else throw new WireError(`Unsupported wire type ${wire}`);
    if (p > b.length) throw new WireError('Truncated field');
  }
  return out;
}

export const unzigzag = (v: number): number => (v >>> 1) ^ -(v & 1);
export const toInt32 = (v: number): number => v | 0;
export const text = (b: Uint8Array): string => new TextDecoder().decode(b);

/** First field with a number, or undefined. */
export function first(fs: Field[], field: number): Field | undefined {
  return fs.find((f) => f.field === field);
}
