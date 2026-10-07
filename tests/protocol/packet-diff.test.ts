import { describe, expect, it } from 'vitest';
import { diffCaptures } from '../../tools/packet-diff/src/diff.js';
import { sonixFeature } from '@openak820/protocols';
import type { RgbConfig } from '@openak820/core';

const pkt = (b: Uint8Array) => ({
  direction: 'host->device' as const,
  kind: 'feature-set',
  bytes: Array.from(b),
});
const lighting = (c: Partial<RgbConfig>) =>
  sonixFeature.encodeLightingData(
    {
      effect: 1,
      color: { r: 255, g: 0, b: 0 },
      colorful: false,
      brightness: 5,
      speed: 3,
      direction: 'left',
      ...c,
    },
    sonixFeature.effectCatalog(5, 5),
  );

describe('packet-diff', () => {
  it('isolates the offset that differs between two experiments (red vs blue)', () => {
    const before = {
      name: 'red',
      packets: [pkt(sonixFeature.commandPacket(0x18)), pkt(lighting({}))],
    };
    const after = {
      name: 'blue',
      packets: [
        pkt(sonixFeature.commandPacket(0x18)),
        pkt(lighting({ color: { r: 0, g: 0, b: 255 } })),
      ],
    };
    const r = diffCaptures(before, after);
    expect(r.variableOffsets).toEqual([1, 3]);
    expect(r.packets[0]!.identical).toBe(true);
    expect(r.packets[1]!.changed).toEqual([
      { offset: 1, before: 255, after: 0 },
      { offset: 3, before: 0, after: 255 },
    ]);
  });

  it('finds the brightness byte across a brightness sweep and the shared command header', () => {
    const sweep = [0, 1, 2, 3, 4, 5].map((b) => pkt(lighting({ brightness: b })));
    const r = diffCaptures(
      { name: 'a', packets: sweep.slice(0, 1) },
      { name: 'b', packets: sweep },
    );
    const col = r.columns.find((c) => c.offset === 9)!;
    expect(col.counter).toBe(true);
    expect(r.columns.filter((c) => !c.constant).map((c) => c.offset)).toEqual([9]);
  });

  it('detects an additive checksum in the last byte', () => {
    const mk = (a: number) => {
      const b = new Array(32).fill(0);
      b[0] = 0x20;
      b[1] = a;
      b[31] = (0x20 + a) & 0xff;
      return { direction: 'host->device' as const, kind: 'output', bytes: b };
    };
    const r = diffCaptures(
      { name: 'x', packets: [mk(1)] },
      { name: 'y', packets: [mk(1), mk(2), mk(7)] },
    );
    expect(r.checksumCandidates).toContainEqual({
      offset: 31,
      algorithm: 'sum8',
      matches: 3,
      of: 3,
    });
    expect(r.repeatedHeader).toEqual([0x20]);
  });
});
