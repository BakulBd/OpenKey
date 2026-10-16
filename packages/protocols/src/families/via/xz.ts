/**
 * Minimal .xz decoder (XZ container, LZMA2 filter only, no BCJ/delta filters), enough for the
 * keyboard definitions Vial firmware stores: the build compresses vial.json with Python's
 * `lzma.compress` (XZ, LZMA2, preset 6). Written from the .xz file format specification and the
 * LZMA/LZMA2 descriptions in XZ Utils (public domain); input is data only, never executed.
 *
 * The whole output is kept in one buffer that doubles as the dictionary, so it suits small payloads
 * (Vial definitions are a few kilobytes); `maxOutput` bounds memory for hostile input.
 */

export class XzError extends Error {}

const MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
const FOOTER_MAGIC = [0x59, 0x5a];
const LZMA2_FILTER = 0x21;
/** Check field size by check type (0 none, 1 CRC32, 4 CRC64, 10 SHA-256). */
const CHECK_SIZE: Record<number, number> = { 0: 0, 1: 4, 4: 8, 10: 32 };

const PROB_INIT = 1024;
const STATES = 12;
const POS_STATES_MAX = 16;
const END_POS_MODEL_INDEX = 14;
const FULL_DISTANCES = 128;
const ALIGN_BITS = 4;
const LEN_LOW = 8;
const LEN_MID = 8;
const LEN_HIGH = 256;

class Output {
  buf: Uint8Array;
  pos = 0;
  constructor(
    initial: number,
    private readonly max: number,
  ) {
    this.buf = new Uint8Array(Math.min(max, Math.max(256, initial)));
  }
  private grow(need: number): void {
    if (need > this.max) throw new XzError(`Output larger than ${this.max} bytes`);
    let n = this.buf.length;
    while (n < need) n *= 2;
    const next = new Uint8Array(Math.min(n, this.max));
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }
  put(b: number): void {
    if (this.pos >= this.buf.length) this.grow(this.pos + 1);
    this.buf[this.pos++] = b;
  }
  /** Byte `dist` + 1 positions back. */
  back(dist: number): number {
    if (dist >= this.pos) throw new XzError('Distance beyond the start of the data');
    return this.buf[this.pos - dist - 1]!;
  }
  copyMatch(dist: number, len: number): void {
    if (dist >= this.pos) throw new XzError('Distance beyond the start of the data');
    if (this.pos + len > this.buf.length) this.grow(this.pos + len);
    for (let i = 0; i < len; i++) {
      this.buf[this.pos] = this.buf[this.pos - dist - 1]!;
      this.pos++;
    }
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

class RangeDecoder {
  private range = 0xffffffff;
  private code = 0;
  constructor(
    private readonly src: Uint8Array,
    public pos: number,
    private readonly end: number,
  ) {
    if (this.next() !== 0) throw new XzError('Corrupt range coder start');
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.next()) >>> 0;
  }
  private next(): number {
    if (this.pos >= this.end) throw new XzError('Truncated LZMA data');
    return this.src[this.pos++]!;
  }
  private normalize(): void {
    if (this.range < 0x01000000) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.next()) >>> 0;
    }
  }
  bit(probs: Uint16Array, i: number): number {
    const p = probs[i]!;
    const bound = (this.range >>> 11) * p;
    let b: number;
    if (this.code < bound) {
      this.range = bound;
      probs[i] = p + ((2048 - p) >>> 5);
      b = 0;
    } else {
      this.range = (this.range - bound) >>> 0;
      this.code = (this.code - bound) >>> 0;
      probs[i] = p - (p >>> 5);
      b = 1;
    }
    this.normalize();
    return b;
  }
  tree(probs: Uint16Array, base: number, bits: number): number {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) | this.bit(probs, base + m);
    return m - (1 << bits);
  }
  reverseTree(probs: Uint16Array, base: number, bits: number): number {
    let m = 1;
    let sym = 0;
    for (let i = 0; i < bits; i++) {
      const b = this.bit(probs, base + m);
      m = (m << 1) | b;
      sym |= b << i;
    }
    return sym;
  }
  direct(bits: number): number {
    let r = 0;
    for (let i = 0; i < bits; i++) {
      this.range >>>= 1;
      let b = 0;
      if (this.code >= this.range) {
        this.code = (this.code - this.range) >>> 0;
        b = 1;
      }
      r = ((r << 1) | b) >>> 0;
      this.normalize();
    }
    return r;
  }
}

/** Length decoder probabilities: choice, choice2, low[16][8], mid[16][8], high[256]. */
const LEN_SIZE = 2 + POS_STATES_MAX * LEN_LOW + POS_STATES_MAX * LEN_MID + LEN_HIGH;

class Lzma {
  lc = 0;
  lp = 0;
  pb = 0;
  state = 0;
  reps = [0, 0, 0, 0];
  isMatch = new Uint16Array(STATES * POS_STATES_MAX);
  isRep = new Uint16Array(STATES);
  isRepG0 = new Uint16Array(STATES);
  isRepG1 = new Uint16Array(STATES);
  isRepG2 = new Uint16Array(STATES);
  isRep0Long = new Uint16Array(STATES * POS_STATES_MAX);
  posSlot = new Uint16Array(4 << 6);
  specPos = new Uint16Array(FULL_DISTANCES - END_POS_MODEL_INDEX);
  align = new Uint16Array(1 << ALIGN_BITS);
  len = new Uint16Array(LEN_SIZE);
  repLen = new Uint16Array(LEN_SIZE);
  literal = new Uint16Array(0x300);

  setProps(props: number): void {
    if (props > 224) throw new XzError('Invalid LZMA properties');
    this.lc = props % 9;
    this.lp = Math.floor(props / 9) % 5;
    this.pb = Math.floor(props / 45);
    if (this.lc + this.lp > 4) throw new XzError('LZMA2 requires lc + lp ≤ 4');
    this.literal = new Uint16Array(0x300 << (this.lc + this.lp));
  }

  reset(): void {
    this.state = 0;
    this.reps = [0, 0, 0, 0];
    for (const a of [
      this.isMatch,
      this.isRep,
      this.isRepG0,
      this.isRepG1,
      this.isRepG2,
      this.isRep0Long,
      this.posSlot,
      this.specPos,
      this.align,
      this.len,
      this.repLen,
      this.literal,
    ])
      a.fill(PROB_INIT);
  }

  private length(rc: RangeDecoder, p: Uint16Array, posState: number): number {
    if (rc.bit(p, 0) === 0) return rc.tree(p, 2 + posState * LEN_LOW, 3);
    if (rc.bit(p, 1) === 0)
      return LEN_LOW + rc.tree(p, 2 + POS_STATES_MAX * LEN_LOW + posState * LEN_MID, 3);
    return LEN_LOW + LEN_MID + rc.tree(p, 2 + POS_STATES_MAX * (LEN_LOW + LEN_MID), 8);
  }

  private distance(rc: RangeDecoder, len: number): number {
    const lenState = Math.min(len, 3);
    const slot = rc.tree(this.posSlot, lenState << 6, 6);
    if (slot < 4) return slot;
    const direct = (slot >>> 1) - 1;
    let dist = ((2 | (slot & 1)) << direct) >>> 0;
    if (slot < END_POS_MODEL_INDEX)
      return dist + rc.reverseTree(this.specPos, dist - slot - 1, direct);
    dist = (dist + (rc.direct(direct - ALIGN_BITS) << ALIGN_BITS)) >>> 0;
    return (dist + rc.reverseTree(this.align, 0, ALIGN_BITS)) >>> 0;
  }

  /** Decodes until `out` holds `target` bytes. */
  run(rc: RangeDecoder, out: Output, target: number): void {
    const pbMask = (1 << this.pb) - 1;
    const lpMask = (1 << this.lp) - 1;
    while (out.pos < target) {
      const posState = out.pos & pbMask;
      const s = this.state;
      if (rc.bit(this.isMatch, (s << 4) + posState) === 0) {
        const prev = out.pos > 0 ? out.back(0) : 0;
        const base = 0x300 * (((out.pos & lpMask) << this.lc) + (prev >>> (8 - this.lc)));
        let sym = 1;
        if (s >= 7) {
          let match = out.back(this.reps[0]!);
          while (sym < 0x100) {
            const mb = (match >>> 7) & 1;
            match = (match << 1) & 0xff;
            const b = rc.bit(this.literal, base + ((1 + mb) << 8) + sym);
            sym = (sym << 1) | b;
            if (mb !== b) break;
          }
        }
        while (sym < 0x100) sym = (sym << 1) | rc.bit(this.literal, base + sym);
        out.put(sym & 0xff);
        this.state = s < 4 ? 0 : s < 10 ? s - 3 : s - 6;
        continue;
      }
      let len: number;
      if (rc.bit(this.isRep, s) === 0) {
        len = this.length(rc, this.len, posState);
        this.state = s < 7 ? 7 : 10;
        const dist = this.distance(rc, len);
        if (dist === 0xffffffff) throw new XzError('Unexpected end marker in an LZMA2 chunk');
        this.reps = [dist, this.reps[0]!, this.reps[1]!, this.reps[2]!];
      } else {
        if (rc.bit(this.isRepG0, s) === 0) {
          if (rc.bit(this.isRep0Long, (s << 4) + posState) === 0) {
            this.state = s < 7 ? 9 : 11;
            out.put(out.back(this.reps[0]!));
            continue;
          }
        } else {
          let dist: number;
          if (rc.bit(this.isRepG1, s) === 0) dist = this.reps[1]!;
          else {
            if (rc.bit(this.isRepG2, s) === 0) dist = this.reps[2]!;
            else {
              dist = this.reps[3]!;
              this.reps[3] = this.reps[2]!;
            }
            this.reps[2] = this.reps[1]!;
          }
          this.reps[1] = this.reps[0]!;
          this.reps[0] = dist;
        }
        len = this.length(rc, this.repLen, posState);
        this.state = s < 7 ? 8 : 11;
      }
      const n = Math.min(len + 2, target - out.pos);
      out.copyMatch(this.reps[0]!, n);
    }
  }
}

/** LZMA2 chunk stream → appended to `out`. Returns the input position after the end byte. */
function lzma2(src: Uint8Array, pos: number, end: number, out: Output): number {
  const lzma = new Lzma();
  let needProps = true;
  for (;;) {
    if (pos >= end) throw new XzError('Truncated LZMA2 data');
    const control = src[pos++]!;
    if (control === 0x00) return pos;
    if (control === 0x01 || control === 0x02) {
      if (pos + 2 > end) throw new XzError('Truncated LZMA2 chunk');
      const size = ((src[pos]! << 8) | src[pos + 1]!) + 1;
      pos += 2;
      if (pos + size > end) throw new XzError('Truncated LZMA2 chunk');
      for (let i = 0; i < size; i++) out.put(src[pos + i]!);
      pos += size;
      continue;
    }
    if (control < 0x80) throw new XzError(`Invalid LZMA2 control byte ${control}`);
    if (pos + 4 > end) throw new XzError('Truncated LZMA2 chunk');
    const unpacked = ((control & 0x1f) << 16) + ((src[pos]! << 8) | src[pos + 1]!) + 1;
    const packed = ((src[pos + 2]! << 8) | src[pos + 3]!) + 1;
    pos += 4;
    const reset = (control >>> 5) & 3;
    if (reset >= 2) {
      if (pos >= end) throw new XzError('Truncated LZMA2 chunk');
      lzma.setProps(src[pos++]!);
      needProps = false;
    } else if (needProps) throw new XzError('LZMA2 chunk without properties');
    if (reset >= 1) lzma.reset();
    if (pos + packed > end) throw new XzError('Truncated LZMA2 chunk');
    const rc = new RangeDecoder(src, pos, pos + packed);
    lzma.run(rc, out, out.pos + unpacked);
    pos += packed;
  }
}

function varint(src: Uint8Array, at: { pos: number }, end: number): number {
  let v = 0;
  for (let i = 0; i < 9; i++) {
    if (at.pos >= end) throw new XzError('Truncated block header');
    const b = src[at.pos++]!;
    v += (b & 0x7f) * 2 ** (7 * i);
    if (!(b & 0x80)) return v;
  }
  throw new XzError('Invalid variable-length integer');
}

/** Decompresses a whole .xz stream. Throws XzError on anything unexpected. */
export function decompressXz(src: Uint8Array, maxOutput = 1 << 20): Uint8Array {
  if (src.length < 24 || MAGIC.some((b, i) => src[i] !== b)) throw new XzError('Not an .xz stream');
  const check = src[7]! & 0x0f;
  const checkSize = CHECK_SIZE[check];
  if (src[6] !== 0 || checkSize === undefined) throw new XzError('Unsupported .xz stream flags');
  const out = new Output(src.length * 4, maxOutput);
  let pos = 12;
  for (;;) {
    if (pos >= src.length) throw new XzError('Truncated .xz stream');
    const sizeByte = src[pos]!;
    if (sizeByte === 0) break; // index follows: all blocks are done
    const headerEnd = pos + (sizeByte + 1) * 4;
    if (headerEnd > src.length) throw new XzError('Truncated block header');
    const flags = src[pos + 1]!;
    if (flags & 0x3c) throw new XzError('Unsupported block flags');
    const at = { pos: pos + 2 };
    if (flags & 0x40) varint(src, at, headerEnd);
    if (flags & 0x80) varint(src, at, headerEnd);
    const filters = (flags & 3) + 1;
    if (filters !== 1) throw new XzError('Only the LZMA2 filter is supported');
    const id = varint(src, at, headerEnd);
    const propsSize = varint(src, at, headerEnd);
    if (id !== LZMA2_FILTER || propsSize !== 1)
      throw new XzError('Only the LZMA2 filter is supported');
    pos = lzma2(src, headerEnd, src.length, out);
    // Block padding to a multiple of four bytes (counted from the block start), then the check.
    const blockStart = headerEnd - (sizeByte + 1) * 4;
    while ((pos - blockStart) % 4) pos++;
    pos += checkSize;
  }
  if (FOOTER_MAGIC.some((b, i) => src[src.length - 2 + i] !== b))
    throw new XzError('Missing .xz stream footer');
  return out.bytes();
}
