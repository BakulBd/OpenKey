/**
 * Differential analysis of two packet captures. Labels are deliberately neutral ("varies with the
 * experiment", "monotonic counter candidate"); naming a byte (brightness, keycode …) is a human
 * decision recorded in the research log once evidence supports it.
 */

export interface CapturePacket {
  direction: 'host->device' | 'device->host';
  kind: string;
  bytes: number[];
}

export interface Capture {
  name: string;
  packets: CapturePacket[];
}

export interface OffsetFinding {
  offset: number;
  before: number;
  after: number;
}

export interface PacketDiff {
  index: number;
  kind: string;
  direction: string;
  identical: boolean;
  changed: OffsetFinding[];
  lengthBefore: number;
  lengthAfter: number;
}

export interface ColumnStats {
  offset: number;
  distinct: number;
  constant: boolean;
  values: number[];
  /** Strictly increasing by a constant step across packets of the same kind. */
  counter: boolean;
}

export interface DiffReport {
  before: { name: string; packets: number };
  after: { name: string; packets: number };
  packetCountDelta: number;
  /** Common prefix shared by all host->device packets (e.g. `04` or `aa`). */
  repeatedHeader: number[];
  packets: PacketDiff[];
  /** Offsets that changed in any aligned packet. */
  variableOffsets: number[];
  /** Offsets identical across all aligned packets in both captures. */
  stableOffsets: number;
  /** Per-offset statistics over the `after` capture's host->device packets. */
  columns: ColumnStats[];
  lengthFieldCandidates: { offset: number; note: string }[];
  addressFieldCandidates: { offset: number; step: number }[];
  checksumCandidates: { offset: number; algorithm: string; matches: number; of: number }[];
}

function commonPrefix(rows: number[][]): number[] {
  if (!rows.length) return [];
  const first = rows[0]!;
  let n = first.length;
  for (const r of rows) {
    let i = 0;
    while (i < n && i < r.length && r[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n);
}

function columnStats(rows: number[][]): ColumnStats[] {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const out: ColumnStats[] = [];
  for (let o = 0; o < width; o++) {
    const col = rows.map((r) => r[o] ?? 0);
    const distinct = new Set(col).size;
    let counter = col.length >= 3;
    if (counter) {
      const step = (col[1]! - col[0]! + 256) % 256;
      counter =
        step !== 0 && col.every((v, i) => i === 0 || (v - col[i - 1]! + 256) % 256 === step);
    }
    out.push({
      offset: o,
      distinct,
      constant: distinct === 1,
      values: [...new Set(col)].slice(0, 16),
      counter,
    });
  }
  return out;
}

const sum8 = (b: number[], end: number) => b.slice(0, end).reduce((s, x) => s + x, 0) & 0xff;
const xor8 = (b: number[], end: number) => b.slice(0, end).reduce((s, x) => s ^ x, 0) & 0xff;
const twos = (b: number[], end: number) => (0x100 - sum8(b, end)) & 0xff;

function checksumCandidates(rows: number[][]): DiffReport['checksumCandidates'] {
  const out: DiffReport['checksumCandidates'] = [];
  if (rows.length < 2) return out;
  const width = Math.min(...rows.map((r) => r.length));
  for (const offset of [width - 1, width - 2, 31, 63].filter(
    (o, i, a) => o > 0 && o < width && a.indexOf(o) === i,
  )) {
    for (const [algorithm, fn] of [
      ['sum8', sum8],
      ['xor8', xor8],
      ['twos-complement', twos],
    ] as const) {
      const matches = rows.filter(
        (r) => r[offset] === fn(r, offset) && r.slice(0, offset).some((x) => x !== 0),
      ).length;
      if (matches >= Math.max(2, Math.ceil(rows.length * 0.8)))
        out.push({ offset, algorithm, matches, of: rows.length });
    }
  }
  return out;
}

export function diffCaptures(before: Capture, after: Capture): DiffReport {
  const n = Math.max(before.packets.length, after.packets.length);
  const packets: PacketDiff[] = [];
  const variable = new Set<number>();
  for (let i = 0; i < n; i++) {
    const a = before.packets[i];
    const b = after.packets[i];
    const changed: OffsetFinding[] = [];
    const len = Math.max(a?.bytes.length ?? 0, b?.bytes.length ?? 0);
    for (let o = 0; o < len; o++) {
      const x = a?.bytes[o] ?? -1;
      const y = b?.bytes[o] ?? -1;
      if (x !== y) {
        changed.push({ offset: o, before: x, after: y });
        variable.add(o);
      }
    }
    packets.push({
      index: i,
      kind: b?.kind ?? a?.kind ?? '?',
      direction: b?.direction ?? a?.direction ?? '?',
      identical: changed.length === 0,
      changed,
      lengthBefore: a?.bytes.length ?? 0,
      lengthAfter: b?.bytes.length ?? 0,
    });
  }
  const out = after.packets.filter((p) => p.direction === 'host->device').map((p) => p.bytes);
  const columns = columnStats(out);
  const width = columns.length;
  const lengthFieldCandidates: DiffReport['lengthFieldCandidates'] = [];
  for (const c of columns) {
    if (c.constant || c.offset > 8) continue;
    const ok = out.every((r) => {
      const v = r[c.offset] ?? 0;
      const tail = r.length - 1 - [...r].reverse().findIndex((x) => x !== 0);
      return v > 0 && Math.abs(tail - v) <= 8;
    });
    if (ok)
      lengthFieldCandidates.push({
        offset: c.offset,
        note: 'value tracks the index of the last non-zero byte',
      });
  }
  const addressFieldCandidates = columns
    .filter((c) => c.counter && c.offset < 8)
    .map((c) => ({
      offset: c.offset,
      step: ((c.values[1] ?? 0) - (c.values[0] ?? 0) + 256) % 256,
    }));
  return {
    before: { name: before.name, packets: before.packets.length },
    after: { name: after.name, packets: after.packets.length },
    packetCountDelta: after.packets.length - before.packets.length,
    repeatedHeader: commonPrefix(out),
    packets,
    variableOffsets: [...variable].sort((a, b) => a - b),
    stableOffsets: width - variable.size,
    columns,
    lengthFieldCandidates,
    addressFieldCandidates,
    checksumCandidates: checksumCandidates(out),
  };
}

export function formatDiff(r: DiffReport, maxPackets = 40): string {
  const hx = (n: number) => (n < 0 ? '--' : n.toString(16).padStart(2, '0'));
  const L: string[] = [];
  L.push(`before: ${r.before.name} (${r.before.packets} packets)`);
  L.push(
    `after:  ${r.after.name} (${r.after.packets} packets)   delta ${r.packetCountDelta >= 0 ? '+' : ''}${r.packetCountDelta}`,
  );
  L.push(`repeated host header: ${r.repeatedHeader.map(hx).join(' ') || '(none)'}`);
  L.push(
    `variable offsets: ${r.variableOffsets.join(', ') || '(none)'}   stable offsets: ${r.stableOffsets}`,
  );
  for (const c of r.lengthFieldCandidates) L.push(`length field candidate @${c.offset}: ${c.note}`);
  for (const c of r.addressFieldCandidates)
    L.push(`address/counter candidate @${c.offset}: step ${c.step}`);
  for (const c of r.checksumCandidates)
    L.push(`checksum candidate @${c.offset}: ${c.algorithm} (${c.matches}/${c.of} packets)`);
  L.push('');
  for (const p of r.packets.filter((x) => !x.identical).slice(0, maxPackets)) {
    L.push(
      `#${p.index} ${p.direction} ${p.kind} len ${p.lengthBefore}→${p.lengthAfter}: ${p.changed
        .slice(0, 24)
        .map((c) => `@${c.offset} ${hx(c.before)}→${hx(c.after)}`)
        .join('  ')}${p.changed.length > 24 ? ' …' : ''}`,
    );
  }
  if (r.packets.every((p) => p.identical)) L.push('Captures are byte-identical.');
  L.push('');
  L.push(
    'Confidence of every finding above: UNVERIFIED until confirmed by a controlled experiment.',
  );
  return L.join('\n');
}
